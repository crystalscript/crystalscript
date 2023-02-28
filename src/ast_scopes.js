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
    InternalError,
    UndeclaredIdentifierError,
    AlreadyDeclaredError,
    SyntaxError
} from './exceptions.js';

import {
    lookup_syscall
} from './ast_syscall.js';

import {
    source_info,
    pretty_op,
    safeStringify,
} from './ast_util.js';


var scope_cache = [];

export function make_scope(node, desc) {
    var scope = null;
    if (Array.isArray(node)) {
        for (var idx=0; idx<scope_cache.length; idx++) {
            if (node === scope_cache[idx].body)
                return scope_cache[idx];
        }        
        scope = {
            op:   'scope',
            body: node,
            desc: desc || 'na',
            vars_declared: {},
            funcs_declared: {}
        };
        scope_cache.push(scope);
    }
    else if (node.op == 'func_def' || node.op == 'anon_func_def' || node.op == 'scope') {
        scope = node;
        if (! node.vars_declared)
            node.vars_declared = {};
        if (! node.funcs_declared)
            node.funcs_declared = {};
    }
    else {
        throw new InternalError(node, `not a scopeable object`);
    }

    scope.declare = function(node, scopes) {
        var ids = null;
        var declared_map = null;

        // modify the scope list: remove the scopes from the root
        // scope +1 to the first globaled func def
        var globalized_scopes = [ ];
        if (! node.globalized_name) {
            for (var idx=scopes.length-1; idx>=1; idx--) {
                globalized_scopes.unshift(scopes[idx]);
                if (scope.globalized_name) break;
            }
        }
        globalized_scopes.unshift(scopes[0]);

        //console.log(`DECLARE: ${node.name || node.id} (${node.op}) scopes=${safeStringify(globalized_scopes,['desc','name'])}`);
        
        if (node.op == 'vardecl' ||
            node.op == 'persist' ||
            node.op == 'use_trait' ||
            node.op == 'trait_def')
        {
            if ( (node.op == 'vardecl' || node.op == 'persist') ) {
                ['-', '!', '?'].forEach(banned => {
                    if (node.id.indexOf(banned) != -1 ) {
                        throw new SyntaxError(node, `identifier '${node.id}' contains illegal character '${banned}'`);
                    }
                });
            }
            ids = [ node.id ];
            declared_map = this.vars_declared;
        }
        
        else if (node.op =='func_def')
        {
            ids = [ node.name ];
            declared_map = this.funcs_declared;
            // in clarity an argument name can't override a previously
            // declared name
            node.args.forEach(arg => {
                ensure_not_declared(globalized_scopes, arg.name, {
                    ctx_node: node
                });
            });
            if (node.globalized_name) {
                // make sure parent doesn't already claim the function name
                // eg: see tests/redeclare3.crystal
                var last_scope = scopes[scopes.length - 1];
                var found = { node: last_scope.vars_declared[node.name] ||
                              last_scope.funcs_declared[node.name] };
                if (found.node) {
                    var info = source_info(found.node);
                    var optxt = pretty_op(found.node);
                    throw new AlreadyDeclaredError(node, `'${node.name}' (${optxt}) was previously declared on line ${info.line}`);
                }
                
                // declare the globalized name in the root scope
                ensure_not_declared([ scopes[0] ], node.globalized_name,
                                    { ctx_node: node });
                scopes[0].funcs_declared = node;
            }
        }

        else if (node.op == 'declare_extern')
        {
            ids = [ node.id ];
            declared_map = this.vars_declared;
        }
        
        else {
            throw new InternalError(node, `invalid decl`);
        }

        ids.forEach(id => {
            ensure_not_declared(globalized_scopes, id, { ctx_node: node });
            declared_map[id] = node;
        });
    }
    return scope;
}

export function scopes_from_nodes(list) {
    var scopelist = [];
    list.forEach(node => {
        scopelist.push(make_scope(node));
    });
    return scopelist;
}

export function add_scope(scopes, scope) {
    // returns a new array
    return scopes.concat(make_scope(scope));
}

export function find_id(scopes, name, opts) {
    var found = null;

    
    for (var idx=scopes.length-1; !found && idx>=0; idx--) {
        var scope = scopes[idx];
        
        if (scope.op != 'func_def' &&
            scope.op != 'anon_func_def' &&
            scope.op != 'scope')
        {
            throw new InternalError(scope, `invalid scope`);
        }

        scope.body.forEach(stmt => {
            if (found) return;
            if ((stmt.op == 'vardecl' ||
                 stmt.op == 'declare_extern' ||
                 stmt.op == 'persist' ||
                 stmt.op == 'trait_def') &&
                stmt.id == name)
            {
                if (!opts || ! opts.find_declared_only || scope.vars_declared[name]) {
                    found = { node:stmt, scope:scope };
                }
            }
            else if (stmt.op == 'func_def' && stmt.name == name) {
                if (!opts || ! opts.find_declared_only || opts.function_hoist || scope.funcs_declared[name]) {
                    // function reference
                    found = { node:{ type:'func', func_def:stmt }, scope:scope };
                }
            }
        });
        
        if (scope.op == 'func_def' || scope.op == 'anon_func_def') {
            scope.args.forEach(arg => {
                if (!found && arg.name == name)
                    found = { node:arg, scope:scope };
            });
        }
    }

    if (!found) {
        // search for a syscall
        var syscall = lookup_syscall(name);
        if (syscall) {
            // syscall reference
            found = { node:{ type:'syscall_ref', syscall:syscall }, scope:null };
        }
    }

    if (!found && opts && opts.find_declared_only) {
        throw new UndeclaredIdentifierError(opts.ctx_node, `undeclared identifier '${name}'`);
    }
    
    return found;
}


export function ensure_not_declared(scopes, name, opts) {
    try {
        var found = find_id(scopes, name, Object.assign({
            find_declared_only: true,
        }, opts));
        if (found) {
            var ctx_node = opts ? opts.ctx_node : null;
            if (found.node.type == 'syscall_ref') {
                throw new AlreadyDeclaredError(ctx_node, `'${name}' conflicts with system function of the same name`);
            }
            else {
                var info = source_info(found.node);
                var optxt = pretty_op(found.node);
                throw new AlreadyDeclaredError(ctx_node, `'${name}' (${optxt}) was previously declared on line ${info.line}`);
            }
        }
    } catch (e) {
        if (! (e instanceof UndeclaredIdentifierError)) throw e;
    }
}



export function my_scope_func_def(scopes, ctx_node) {
    for (var idx=scopes.length-1; idx>=0; idx--) {
        var scope = scopes[idx];
        if (scope.op == 'func_def') return scope;
    }
}


export function generate_fn_name(old_name, scopes, taken) {
    // generate a new unique name for a globalized function
    if (scopes.length == 1) {
        if (! old_name) throw new InternalError(`no name`);
        return old_name;
    }
    
    var name_prefix = [ ];
    scopes.forEach(scope => {
        if (scope.name) name_prefix.push(scope.name);
    });
    if (! old_name) {
        old_name = 'anon';
    }
    var name_base = `inner-${name_prefix.join('-')}-${old_name}`;
    var name = name_base;
    var n = 2;
    while (taken && taken[name]) {
        name = name_base + '-' + n++;
    }
    return name;
}

export function generate_id_name(old_name, scopes, existing_args) {
    // generate a new unique name for a globalized function argument
    var existing = {};
    existing_args.forEach( arg => existing[arg.name]=true );
    
    var proposed = `cl`;
    scopes.forEach(scope => {
        proposed += (scope.name ? scope.name.substr(0,1) : 's');
    });
    proposed += '-' + old_name;
    var n = 0;
    var cur = proposed;
    while ( existing[cur] ) {
        n += 1;
        cur = proposed + n;
    }
    return cur;
}

