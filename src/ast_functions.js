// Copyright (C) 2023 Keith Woodard
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
    SyntaxError,
    RecursionError,
    InternalError,
    AlreadyDeclaredError
} from './exceptions.js';

import {
    add_scope,
    make_scope,
    scopes_from_nodes,
    find_id,
    generate_fn_name,
    generate_id_name,
} from './ast_scopes.js';

import {
    walk_cb,
    copy_type,
} from './ast_util.js';

import {
    lookup_syscall
} from './ast_syscall.js';

import {
    optm_move_node
} from './ast_optimize.js';



function ensure_unique_arg_names(func_def) {
    var arg_names={};
    func_def.args.forEach(v => {
        if (arg_names[v.name]) throw new SyntaxError(v, `duplicate argument name '${v.name}'`);
        arg_names[v.name] = true;
    });
}

function uses_closure(...scopes) {
    // a function definition uses closure if any id is not local and
    // not global, or if any of it's inner functions use closure
    var scope = scopes[scopes.length-1];
    var found = false;
    walk_cb(scope.body, node => {
        if (found) return false;
        if (node.op == 'func_def' || node.op == 'anon_func_def') {
            found = uses_closure(node);
            return false;
        }
        else if (node.op == 'if') {
            found = uses_closure(...scopes, make_scope(node.body, 'then'));
            if (node.elsif) {
                node.elsif.forEach(elsif => {
                    if (found) return;
                    found = uses_closure(...scopes, make_scope(elsif.body, 'elsif'));
                });
            }
            if (!found && node.else_body)
                found = uses_closure(...scopes, make_scope(node.else_body, 'else'));
            return false;
        }
        else if (node.op == 'func_call' && node.name.op == 'id') {
            found = ! find_id(scopes, node.name.id);
        }
        else if (node.op == 'id') {
            found = ! find_id(scopes, node.id);
        }
        return ! found;
    });
    return found;
}


export function validate_functions(ast) {
    // rules:
    // 1. no recursion
    // 2. no duplicate arg names
    // 3. prepare ast for globalizing inner functions
    // 4. complete the initialization of externs

    // ctx: global stuff to keep track of during recursion
    var ctx = {
        global_functions: {}, // key=func-name, val={node:definition, calls:[func-names]}
    };

    ast.forEach(definition => {
        if (definition.op == 'func_def') {
            // pre-populate this because in clarity, a function can
            // call another function that's declared after it
            if (ctx.global_functions[definition.name]) {
                throw new AlreadyDeclaredError(definition, `duplicate function name '${definition.name}'`);
            }
            ctx.global_functions[definition.name] = {};
        }
    });
    
    _validate(ctx, make_scope(ast), scopes_from_nodes([]));

    // find function call recursion
    function gather_uniq_calls(list, seen) {
        list.forEach(name => {
            if (!seen[name]) {
                seen[name] = true;
                gather_uniq_calls(ctx.global_functions[name].calls, seen);
            }
        });
    }

    // for each function, produce a list of all possible functions
    // called, direct and indirect
    var dep_order = [];
    for (var name in ctx.global_functions) {
        var func_info = ctx.global_functions[name];
        var recursed_calls={}; // key:func-name, value=true
        gather_uniq_calls(func_info.calls, recursed_calls);
        if (recursed_calls[name]) {
            throw new RecursionError(func_info.node, `function ${name} has recursion`);
        }
        if (func_info.exists_globally) {
            recursed_calls = Object.keys(recursed_calls);
            dep_order.push({
                name: name,
                node: func_info.node,
                id_resolution_scopes: func_info.id_resolution_scopes,
                count: recursed_calls.length,
                // calls: recursed_calls
            });
        }
    }

    // Produce a function ordering that will allow us to determine
    // function types: order from least dependent to most dependent.
    //
    // Doing it this way means we won't have to rearrange the ast,
    // which will preserve the order functions are output in the final
    // clarity code.
    //
    // eg: a(b,c) b(c), c(), d(a), e(d) => c,b,a,d,e
    //    c=[]
    //    b=[c]
    //    a=[b,c]
    //    d=[a,b,c]
    //    e=[d,a,b,c]
    dep_order.sort((a,b)=> { return a.count - b.count; });
    return dep_order;
}

function _validate(ctx, scope, scopes) {
    // ctx: global context
    // scope: scope we're validating
    // scopes: id visibility stack not including scope

    // TODO: make 'calls' an assoc array
    var calls = []; // a list of func_call's to inner(globalized) and
                    // global functions
    var inner_functions = {}; // key=func-name, val=globalized-name
    scope.inner_functions = inner_functions;

    if (scope.op == 'func_def')
        ensure_unique_arg_names(scope);

    var newscopes = add_scope(scopes, scope);

    walk_cb(scope.body, node => {
        if (node.op == 'func_def') {
            node.globalized_name =
                generate_fn_name(node.name, newscopes, ctx.global_functions);
            node.uses_closure = uses_closure(newscopes[0], node);
            inner_functions[node.name] = node.globalized_name;
            _validate(ctx, make_scope(node), newscopes);
            return false;
        }
        else if (node.op == 'anon_func_def') {
            node.globalized_name =
                generate_fn_name(null, newscopes, ctx.global_functions);
            node.uses_closure = uses_closure(newscopes[0], node);
            _validate(ctx, make_scope(node), newscopes);
            return false;
        }
        else if (node.op == 'if') {
            var add_calls =
                _validate(ctx, make_scope(node.body, 'then'), newscopes);
            calls.push(...add_calls);

            if (node.elsif) {
                node.elsif.forEach(elsif => {
                    add_calls =
                        _validate(ctx, make_scope(elsif.body, 'elsif'), newscopes);
                    calls.push(...add_calls);
                });
            }
            if (node.else_body) {
                add_calls =
                    _validate(ctx, make_scope(node.else_body, 'else'), newscopes);
                calls.push(...add_calls);
            }
            return false;
        }
        return true;
    });

    function find_inner_function(scopes, name) {
        for (var idx=scopes.length-1; idx>=1; idx--) {
            var inner_functions = scopes[idx].inner_functions;
            if (!inner_functions) continue;
            var s = inner_functions[name];
            if (s) return s;
        }
        return null;
    }

    walk_cb(scope.body, node => {        
        if (node.op == 'func_def' || node.op == 'anon_func_def') {
            return false;
        }
        else if (node.op == 'if') {
            return false;
        }
        else if (node.op == 'func_call' && node.name.op=='id') {
            if (ctx.global_functions[node.name.id]) {
                calls.push(node.name.id);
            }
            else {
                // examine scope list for the name of an inner function
                var globalizedfn = find_inner_function(
                    newscopes,
                    node.name.id
                );
                
                if (globalizedfn) {
                    calls.push(globalizedfn);
                }
                else if (lookup_syscall(node.name.id)) {
                    // some syscalls accept a function name as an
                    // argument. find any id within argument
                    // expressions that matches a known function
                    // name
                    node.args.forEach(n => {
                        if (n.op == 'id') {
                            if (ctx.global_functions[n.id]) {
                                calls.push(n.id);
                            }
                            else {
                                globalizedfn = find_inner_function(
                                    newscopes,
                                    n.id
                                );
                                if (globalizedfn) {
                                    calls.push(globalizedfn);
                                }
                            }
                        }
                    });
                }

                else {
                    throw new SyntaxError(node, `unknown function '${node.name.id}'`);
                }
            }
        }
        return true;
    });

    if (scope.op == 'func_def') {
        var global_name = scope.globalized_name || scope.name;
        if (global_name === scope.name) delete scope.globalized_name;
        ctx.global_functions[global_name] = {
            node: scope,
            calls,
            exists_globally: global_name === scope.name,
            id_resolution_scopes: newscopes
        };
    }
    else {
        return calls;
    }
}




export function globalize_inner_functions(ast) {
    // all ast types must have been pre-calculated before calling
    // this function
    //
    // newfunctions is an array where each element is an object that
    //  pertains to a new globalized function that needs to be added
    //  to the ast
    //   { name: <globalized-fn-name>,
    //     node: <ref to func_def> }
    //
    var scopes = scopes_from_nodes([ ast ]);
    var insertions = [];
    
    ast.forEach( (definition, idx) => {
        if (definition.op == 'func_def') {
            var newfunctions = [];
            _globalize(make_scope(definition), scopes, newfunctions);

            newfunctions.reverse();
            insertions.push({
                idx,
                newnodes: newfunctions.map(f => f.node)
            });
        }
    });

    // add globalized functions to ast root
    insertions.reverse();
    insertions.forEach(insertion => {
        ast.splice(insertion.idx, 0, ...insertion.newnodes);
    });    
}



function _globalize(scope, scopes, newfunctions) {
    var newscopes = add_scope(scopes, scope);

    walk_cb(scope.body, node => {
        
        if (node.op == 'if') {
            _globalize(make_scope(node.body, 'then'), newscopes, newfunctions);
            if (node.elsif) {
                node.elsif.forEach(elsif => {
                    _globalize(make_scope(elsif.body, 'elsif'), newscopes, newfunctions);
                });
            }
            if (node.else_body)
                _globalize(make_scope(node.else_body, 'else'), newscopes, newfunctions);
            return false;
        }

        else if (node.op == 'id') {
            // func types have a reference to a func_def, which we
            // don't want to recurse into
            return false;
        }
        
        else if (node.op == 'func_def' || node.op == 'anon_func_def') {
            
            // inner functions
            _globalize(node, newscopes, newfunctions);
            
            // set a new unique name for the globalized function
            var old_fn_name = node.name; // undefined for anon
            if (! node.globalized_name) {
                throw new InternalError(`no globalized name`);
            }
            node.name = node.globalized_name;
            
            // determine what vars are accessed via closure and make
            // them arguments. eg:
            //
            // function x(string(20) s) {
            //    const var1 = u100;
            //    function y(uint v) {
            //       if (s == "abc") { return var1; }
            //       return v;
            //    }
            //    return y(u0);
            // }
            //
            // => (define-private ((x-y ((uint v) (string(20) x-s) (uint x-var1))) body)

            var closure_vars={};
            var closure_vars_order = [];
            
            // eliminate the global scope and include the function def
            // for the purposes of finding closure vars
            var inner_scopes = add_scope(newscopes.slice(1), node);

            walk_cb(node.body, bodynode => {
                // note: body func_def's have been removed by the
                // recursive call above
                if (bodynode.op != 'id') return true;
                
                var found = find_id(inner_scopes, bodynode.id);
                if (! found || found.scope === node || found.scope === null)
                    return true;
                if (found.node.type == 'func') {
                    // functions are refactored by the worker
                    // below. they're all global now...
                    return false;
                }

                // the id is declared outside the local scope
                var new_name = generate_id_name(bodynode.id, newscopes, node.args);
                
                if (! closure_vars[bodynode.id]) {
                    // add a new argument to this func_def
                    var typedef = {
                        name: new_name,
                        access: 'scope',
                        protect: 'const',
                        closure: bodynode.id
                    };
                    copy_type(found.node, typedef);
                    node.args.push(typedef);
                    
                    // keep track of closure vars to add them as
                    // arguments to function calls made from the
                    // outer body
                    closure_vars[bodynode.id] = {
                        op: 'id',
                        id: bodynode.id,
                    };
                    closure_vars_order.push(bodynode.id);
                }
                
                // change the id to the name of the new argument name
                bodynode.id = new_name;
                return true;
            });
                        
            // remove the function definition from the body
            // mark the func_def as "globalized"
            
            node.globalized = true;
            delete node['globalized_name'];
            const nf = {
                name: node.name,
                node: optm_move_node(node, {}),
            };
            newfunctions.push(nf);

            if (nf.node.op == 'func_def') {
                // remove the func_def from the body completely
                node.op = 'nop';

                // change func_call and 'func' id's in the outer scope
                // to refer to the new name and add the new arguments
                walk_cb(scope.body, refactor_worker, {
                    closure_vars,
                    closure_vars_order,
                    old_fn_name,
                    old_fn_def: node,
                    new_fn_def: nf.node
                });
            }
            else {
                // change the anon_func_def entry to a function reference
                // mark the func_def as "anonymous"
                nf.node.anonymous = true;
                Object.assign(node, {
                    op: 'id',
                    id: nf.name,
                    type: 'func',
                    func_def: nf.node
                });
            }

            return false;
        }

        return true;
    });
}



function refactor_worker(node, refactor_args) {
    // this is a callback handler for walk_cb.  when a function is
    // globalized, it get a new name and may have new arguments for
    // closure vars. this function performs the work of doing the
    // renaming and adding function call arguments to places that
    // refer to the old name
    const old_fn_name = refactor_args.old_fn_name;
    const old_fn_def = refactor_args.old_fn_def;  // nop node
    const new_fn_def = refactor_args.new_fn_def;
    const closure_vars = refactor_args.closure_vars;
    const closure_vars_order = refactor_args.closure_vars_order;

    if (node.op == 'func_call' && node.name.func_def === old_fn_def) {
        node.name = {
            op: 'id',
            id: new_fn_def.name,
            type: 'func',
            func_def: new_fn_def
        };
        closure_vars_order.forEach(key => {
            node.args.push(closure_vars[key]);
        });
    }
    else if (node.op == 'id' && node.type == 'func' && node.id == old_fn_name) {
        node.id = new_fn_def.name;
        node.func_def = new_fn_def;
    }
    else if (node.op == 'if' || node.op == 'func_def' || node.op == 'anon_func_def') {
        // only traverse body's if they don't have a local
        // id with the same name
        var found = find_id(
            scopes_from_nodes([ node.body ]),
            old_fn_name
        );
        if (! found) walk_cb(node.body, refactor_worker, refactor_args);
        
        if (node.elsif) {
            node.elsif.forEach(elsif => {
                found = find_id(
                    scopes_from_nodes([ elsif.body ]),
                    old_fn_name
                );
                if (! found) walk_cb(elsif.body, refactor_worker, refactor_args);
            });
        }
        
        if (node.else_body) {
            found = find_id(
                scopes_from_nodes([ node.else_body ]),
                old_fn_name);
            if (!found) walk_cb(node.else_body, refactor_worker, refactor_args);
        }
        return false;
    }
    return true;
}


