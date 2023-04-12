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
    ParserError,
    InternalError,
    SyntaxError,
    TypeMismatchError,
    UndeterminedTypeError,
    NotSupportedError,
    SizeError,
    ArgumentError,
    GeneralWarning
} from './exceptions.js';

import {
    add_scope,
    scopes_from_nodes,
    find_id,
} from './ast_scopes.js';

import {
    source_info,
    optional_of_any_type,
    list_of_any_type,
    trait_of_any_type,
    any_response,
    copy_type,
    is_undetermined_type,
    is_sequence_type,
    itemtype_of,
    node_is_typeless,
    merge_response_types,
    equal_types,
    equal_types_strict,
    is_type_none,
    ensure_equal_types,
    ensure_type,
    type_is_one_of,
    ensure_type_is_one_of,
    coerce_literal,
    coerce_to_optional,
    coerce_func_call_args,
    coerce_lit_map_values,
    unwrap_optional,
    find_first_return,
    truthy_node,
    walk_cb,
    pretty_type,
    safeStringify,
} from './ast_util.js';

import {
    add_comment
} from './ast_comments.js';

import {
    check_if_function_implements_trait
} from './ast_traits.js';

import {
    optm_move_node,
    optm_raise_child,
    optm_reset_node,
    optm_remove_from_array
} from './ast_optimize.js';

import {
    make_syscall
} from './ast_syscall.js';


import { _fill_types_foreach } from './ast_types_foreach.js';
import { _fill_types_brackets } from './ast_types_brackets.js';
import { _fill_types_func_call } from './ast_types_func_call.js';


class FillTypeCtx {
    constructor(opts, additional_opts) {
        this.backfill_needed = false;
        this.backfilling = false;
        this.allow_incomplete = false;
        this.function_hoist = true;
        this.find_declared_only = true;
        this.optimize = true;
        this.ctx_node_stack = [];
        Object.assign(this, opts, additional_opts);
        if (! this.compile) this.compile = {
            warning: function() { }  // no output
        };
    }

    ctx_node_push(node) {
        this.ctx_node_stack.push(node);
    }

    ctx_node_pop() {
        return this.ctx_node_stack.pop();
    }

    get ctx_node() {
        return this.ctx_node_stack[this.ctx_node_stack.length - 1];
    }
    
    handle_undetermined_error(e, msg) {
        if (! (e instanceof UndeterminedTypeError)) throw e;
        this.backfill_needed = true;
        if (! this.allow_incomplete) {
            if (msg) e.set_message(msg);
            throw e;
        }
    }
};



export function determine_types(compile, ast, func_dep_order) {
    // compile: compile options
    // func_dep_order: the order in which functions should be
    //   processed to avoid any undetermined types. it has the following
    //   structure:
    //
    //   [
    //     {
    //       name:func-name,
    //       node:<reference to func_def node>,
    //       id_resolution_scopes:<array of scopes>,
    //       count:n
    //     }, ...
    //   ]
    //
    // it is returned by the function validate_functions() in
    // ast_functions.js

    //
    // intermigle global const, persist, and traits, preserving order.
    // ** ensure non-function nodes are processed after all func_def's
    // they were after before **
    //
    // eg:
    //  source code:      a() const b()
    //  func_dep_order:   b(), a()
    //  processing order: b(), a(), const
    //
    var inserts = [];
    var cur_idx = -1; // the highest func_dep_order index for the last func_def seen
    ast.forEach(definition => {
        if (definition.op == 'func_def') {
            for (var idx=cur_idx+1; idx<func_dep_order.length; idx++) {
                if (func_dep_order[idx].name == definition.name) {
                    cur_idx = idx;
                    break;
                }
            }
        }
        else {
            inserts.push({
                after: cur_idx,
                node: definition,
            });
        }
    });

    inserts.reverse();
    
    var just_root_scopes = scopes_from_nodes([ ast ]);
    inserts.forEach(insert => {
        func_dep_order.splice(insert.after + 1, 0, {
            name: insert.node.id || insert.node.op,
            node: insert.node,
            id_resolution_scopes: just_root_scopes
        });
    });


    // process everything
    
    func_dep_order.forEach(node_info => {
        var node = node_info.node;
        var scopes = node_info.id_resolution_scopes;
        try {
            _fill_global_types(node, scopes, compile);
        } catch (e) {
            if (node.import_path && (e instanceof ParserError)) {
                e.set_file(node.import_path);
            }
            throw e;
        }
    });
}



function _fill_global_types(node, scopes, compile) {
    // compile: compile options
    
    if (node.op == 'func_def') {
        var func_def = node;

        // fill types in args
        _fill_types(func_def.args, 'func_def_args', [ scopes[0] ],
                    new FillTypeCtx({ compile }));
        
        // fill body types
        var ctx_body = new FillTypeCtx({ allow_incomplete:true, compile });
        _fill_types(func_def.body, 'body', scopes, ctx_body);        
        if (ctx_body.backfill_needed) {
            _fill_types(func_def.body, 'body', scopes,
                        new FillTypeCtx({ backfilling:true, compile }));
        }

        var return_type = get_fn_return_type(func_def);
        copy_type(return_type, func_def);
        add_comment(func_def, `;; returns ${pretty_type(return_type)}`);

        if (func_def.vis == 'public' &&
            ! equal_types(func_def, any_response))
        {
            throw new TypeMismatchError(func_def, `public function '${func_def.name}' must return a response type using ok() or err()`);
        }
        else if (func_def.vis == 'read-only' &&
                 ! equal_types(func_def, any_response))
        {
            compile.warning(func_def, `read-only function '${func_def.name}' does not return a response type using ok() or err().`);
        }

        check_if_function_implements_trait(func_def, scopes, { compile });
        
        scopes[0].declare(func_def, scopes.slice(0, -1));
    }
    
    else if (node.op == 'vardecl') {
        _fill_types(node.expr, 'expr', scopes, new FillTypeCtx({
            // clarity define-constant behavior: "The expression passed into the definition is evaluated at contract launch, in the order that it is supplied in the contract. This can lead to undefined function or undefined variable errors in the event that a function or variable used in the expression has not been defined before the constant."
            function_hoist: false,
            compile
        }));
        if (type_is_one_of(node.expr, [
            { type:'typedef' },
            { type:'func' },
            { type:'syscall_ref' }
        ])) {
            throw new SyntaxError(node.expr, `not a valid assignment, type '${pretty_type(node.expr)}'`);
        }
        copy_type(node.expr, node);
        scopes[0].declare(node, scopes);
    }
    
    else if (node.op == 'persist') {
        var fill_opts = new FillTypeCtx({ compile });
        if (node.type == 'datamap' || node.type == 'nft') {
            // nothing to do
        }
        else if (node.type == 'ft') {
            // ensure total supply is a uint
            if (node.total_supply) {
                _fill_types(node.total_supply, 'expr', scopes, fill_opts);
                coerce_literal(node.total_supply, { type:'uint' });
                ensure_equal_types(
                    node.total_supply,
                    { type:'uint' },
                    { ctx_node: node },
                    `total supply`
                );
            }
        }
        else {
            // ensure initial value has same type as declared type
            _fill_types(node.initial_val, 'expr', scopes, fill_opts);
            coerce_literal(node.initial_val, node);
            ensure_equal_types(
                node,
                node.initial_val,
                { ctx_node: node },
                `initial value`
            );
        }
        scopes[0].declare(node, scopes);
    }
    
    else if (node.op == 'trait_def') {
        scopes[0].declare(node, scopes);
        node.traits.forEach(trait => {
            ensure_equal_types(
                trait,
                any_response,
                { ctx_node:node },
                `trait functions must return a response type in the form 'response<oktype,errtype>'`
            );
            if (trait.op == 'extern_func_def') {
                _fill_types(trait.args, 'extern_func_def_args',
                            scopes, new FillTypeCtx({ compile }));
            }
        });
    }
    
    else if (node.op == 'impl_trait') {
        _fill_types(node.expr, 'expr', scopes, new FillTypeCtx({ compile }));
        if (equal_types(node.expr, { type:'principal' })) {
            // although this works, it's inconsistent and will lead to
            // confusion
            throw new NotSupportedError(node, `specifying a contract trait name using contract id syntax is not supported. Instead, specify the trait to implement by importing the contract that defines the trait using 'import', then reference the import and trait name`);
        }
        ensure_type_is_one_of(
            node.expr, [ { type: 'trait_def' }, ],
            { ctx_node: node },
        );
    }
    
    else if (node.op == 'declare_extern') {
        if (!node.contract_id) {
            throw new SyntaxError(node, `a contract must be associated with the extern declaration`);
        }
        var fill_opts = new FillTypeCtx({ compile });
        _fill_types(node.contract_id, 'expr', scopes, fill_opts);
        node.defs.forEach( def => {
            def.contract_id = node.contract_id;
            if (def.op == 'extern_func_def') {
                _fill_types(def.args, 'extern_func_def_args',
                            scopes, fill_opts);
            }
            else if (def.op == 'extern_trait_def') {
                def.traits.forEach(trait => {
                    trait.contract_id = node.contract_id;
                    _fill_types(trait.args, 'extern_func_def_args',
                                scopes, fill_opts);
                });
            }
            else if (def.op == 'extern_trait_def_impl') {
                _fill_types(def.impl_contract_id, 'expr', scopes, fill_opts);
            }
        });
        if (node.id) {
            // there is no way to refer to the node using the
            // contract principal in other parts of the compiled
            // code, so only declare it when an alias is available
            scopes[0].declare(node, scopes);
        }
    }
    
    else {
        var fill_opts = new FillTypeCtx({
            function_hoist: false,
            compile
        });
        _fill_types(node, 'stmt', scopes, fill_opts);
    }
}





export function check_type(opts, node) {
    // check_type(opts, node, ...., [msg]): ensure the given
    //   nodes have a determined type and throw if
    //   opts.allow_incomplete is false
    //
    // opts: FillTypeCtx instance
    // msg: optional detailed error message
    var msg = null;
    var last_idx = arguments.length-1;
    if (last_idx>=0 && typeof arguments[last_idx] == 'string') {
        msg = arguments[last_idx--];
    }
    for (var idx = 1; idx <= last_idx; idx++) {
        var arg = arguments[idx];
        if (is_undetermined_type(arg)) {
            opts.handle_undetermined_error(
                new UndeterminedTypeError(
                    opts.ctx_node || arg,
                    msg || `undetermined type`
                )
            );
            return false;
        }
        if (arg.type == 'func' && !check_type(opts, arg.func_def)) {
            return false;
        }
    }
    return true;
}



export function _fill_types(node, node_type, scopes, opts) {
    if (!node || !node_type || !scopes || !opts)
        throw new InternalError(`invalid argument to _fill_types (${node ? node.op : 'invalid'}, ${node_type}, ${scopes ? scopes.length : 'invalid'}, ${opts ? 'ok' : 'invalid'})`);
    
    /*
     * scopes: stack of references to current scopes. items may only
     *         refer to ast entries that are func_def's or code
     *         "bodies". the first entry must be the ast root.  this
     *         will always be [ ast, func_def, body, ... ]
     *
     * opts: allow_incomplete: if true will allow type completion as
     *       much as possible without throwing. 'backfill_needed' will
     *       be added to opts if if backfilling is required.  
     */

    if (! Array.isArray(node) &&
        ! node_is_typeless(node) &&
        ! is_undetermined_type(node))
    {
        // already fulfilled

        // literals have their type field completed during ast
        // construction, but compound literals like list and maps are
        // not compete - itemtype, and maptype still need to be
        // determined. we'll just run though again for those.

        if (node.op != 'lit') {
            return false;
        }
    }
    

    opts.ctx_node_push(node);
        
    if (node_type == 'body') {
        if (node.length == 0) {
            var parent_scope = scopes[scopes.length - 1];
            throw new SyntaxError(parent_scope, `empty body`);
        }

        var scope = scopes[scopes.length-1];

        node.forEach(stmt => {
            if (stmt.op == 'vardecl') {
                _fill_types(stmt.expr, 'expr', scopes, opts);
                if (check_type(opts, stmt.expr, `'${stmt.id}' has undetermined type`)) {
                    if (type_is_one_of(stmt.expr, [
                        { type:'func' }, { type:'syscall_ref' }]))
                    {
                        // eg: clarity error: "use of unresolved variable 'map'"
                        throw new NotSupportedError(stmt, `variables may not hold function references in Clarity`);
                    }
                    if (type_is_one_of(stmt.expr, [{ type:'typedef' }])) {
                        throw new SyntaxError(stmt, `not a valid assignment, type '${pretty_type(stmt.expr)}'`);
                    }
                    copy_type(stmt.expr, stmt);
                }
                if (! opts.backfilling) {
                    // don't declare twice
                    scope.declare(stmt, scopes);
                }
            }
            else {
                _fill_types(stmt, 'stmt', scopes, opts);
            }
        });
    }
    
    else if (node_type == 'stmt') {
        var scope = scopes[scopes.length-1];
        
        if (node.op == 'return') {
            _fill_types(node.expr, 'expr', scopes, opts);
            if (check_type(opts, node.expr)) {
                copy_type(node.expr, node);
            }
        }
        
        else if (node.op == 'if') {
            if (opts.optimize) {
                var done = false;
                while (!done) {
                    _fill_types(node.expr, 'expr', scopes, opts);
                    if (check_type(opts, node.expr)) {
                        truthy_node(node.expr);
                        ensure_type(node.expr, {type:'bool'},
                                    { ctx_node: node.expr },
                                   `if expression`);
                    }
                    
                    if (node.expr.op == 'lit' && node.expr.val==false &&
                        node.elsif && node.elsif.length > 0)
                    {
                        // 'if' expr is false, so eliminate the body and
                        // promote an elsif
                        node.body = node.elsif[0].body;
                        node.expr = node.elsif[0].expr;
                        node.elsif.shift();
                        if (node.elsif.length == 0) delete node.elsif;
                    }
                    else {
                        done = true;
                    }
                }
                
                if (node.expr.op == 'lit' && node.expr.val==false) {
                    // there are no elsif's
                    if (node.else_body) {
                        node.body = node.else_body;
                        node.else_body = null;
                        node.expr.val = true;
                        node.op = 'new_scope';
                    }
                    else {
                        optm_reset_node(node, { op:'nop' });
                    }
                }
            }
            
            if (node.op != 'nop') {
                // if a body has a return_type, it exits the function
                // via 'return'
                _fill_types(node.body, 'body', add_scope(scopes, node.body),
                            opts);
                node.body_return_type = get_body_return_type(node.body);
                
                if (node.elsif) {
                    var removals=[];
                    node.elsif.forEach((elsif, idx) => {
                        _fill_types(elsif.expr, 'expr', scopes, opts);
                        if (opts.optimize && elsif.expr.op == 'lit' &&
                            elsif.expr.val==false)
                        {
                            removals.push(idx);
                        }
                        else
                        {
                            if (check_type(opts, elsif.expr)) {
                                truthy_node(elsif.expr);
                                ensure_type(elsif.expr ,{type:'bool'},
                                            { ctx_node: elsif.expr },
                                            `else if expression`);
                            }
                            _fill_types(elsif.body, 'body',
                                        add_scope(scopes, elsif.body), opts);
                            elsif.body_return_type =
                                get_body_return_type(elsif.body);
                        }
                    });
                    optm_remove_from_array(node.elsif, removals);
                    if (node.elsif.length == 0) delete node.elsif;
                }
                
                node.else_body_return_type = null;
                if (node.else_body) {
                    _fill_types(node.else_body, 'body',
                                add_scope(scopes, node.else_body), opts);
                    // if the else-body has a return_type, it exits the function
                    node.else_body_return_type = get_body_return_type(node.else_body);
                }
            }
        }
        
        else if (node.op == 'func_def') {
            _fill_types(node.args, 'func_def_args', scopes, opts);
            _fill_types(node.body, 'body', add_scope(scopes, node), opts);
            var return_type = get_fn_return_type(node);
            if (check_type(opts, return_type)) {
                copy_type(return_type, node);
            }
            if (! opts.backfilling) {
                // don't declare twice
                scope.declare(node, scopes);
            }
        }
        
        else {
            _fill_types(node, 'expr', scopes, opts);
            if (check_type(opts, node)) {
                if (equal_types(node, any_response)) {
                    opts.compile.warning(node, `unchecked response`);
                    optm_reset_node(
                        node, 
                        make_syscall('is-ok', [optm_move_node(node,{})])
                    );
                    _fill_types(node, 'expr', scopes, opts);
                }
            }
        }

    }

    else if (node_type == 'func_def_args' ||
             node_type == 'extern_func_def_args')
    {
        node.forEach((arg, idx) => {
            if (! equal_types(arg, trait_of_any_type)) return;
            
            _fill_types(arg.itemtype, 'expr', scopes, opts);
            
            if (check_type(opts, arg.itemtype)) {
                
                if (node_type == 'func_def_args' &&
                    equal_types(arg.itemtype, { type:'principal' }))
                {
                    // may only use contract from 'import'
                    throw new ArgumentError(node, `specify the trait to accept as argument ${idx+1} by importing the contract that defines the trait using 'import', then reference the trait name from the import`);
                }
                
                ensure_type_is_one_of(arg.itemtype, [
                    { type:'principal' },
                    { type:'trait_def' },
                ], opts, `argument '${idx+1}'`);
            }
        });
    }
    
    else if (node_type == 'expr') {
        if (node.op == '<=' ||
            node.op == '>=' ||
            node.op == '<' ||
            node.op == '>')
        {
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.a, node.b)) {
                unwrap_optional(node.a, node.b);
                coerce_literal(node.b, node.a);
                coerce_literal(node.a, node.b);
                ensure_equal_types(node.a, node.b, opts,
                                   `operator '${node.op}'`);
                ensure_type_is_one_of(node.a, [
                    { type:'int' },
                    { type:'uint' },
                    { type:'string' },
                    { type:'string-ascii' },
                    { type:'buff' },
                ], opts, `operator '${node.op}'`);
                copy_type({ type:'bool' }, node);
            }
        }
        else if (node.op == '==' ||
                 node.op == '!=')
        {
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.a, node.b)) {
                if (is_type_none(node.a) &&
                    equal_types(node.b, optional_of_any_type) ||
                    is_type_none(node.b) &&
                    equal_types(node.a, optional_of_any_type))
                {
                    // none <=> optional
                    // to_clarity() will output (is-none x)
                    copy_type({ type:'bool' }, node);
                }
                else if (is_type_none(node.a) &&
                         ! is_type_none(node.b) ||
                         is_type_none(node.b) &&
                         ! is_type_none(node.a)) {
                    // none <=> not-optional
                    // this is always true (!=) or false (==)
                    // clarity returns a TypeError on this comparison, so
                    // we must change it here
                    var op = node.op;
                    optm_reset_node(node);
                    Object.assign(node, {
                        op:'lit',
                        type:'bool',
                        val: op=='!='
                    });
                }
                else {
                    if (equal_types(node.a, optional_of_any_type) &&
                        ! equal_types(node.b, optional_of_any_type)) {
                        // optional <=> non-optional
                        coerce_literal(node.b, node.a.itemtype);
                        coerce_to_optional(node.b);
                    }
                    else if (equal_types(node.b, optional_of_any_type) &&
                             ! equal_types(node.a, optional_of_any_type)) {
                        // optional <=> non-optional
                        coerce_literal(node.a, node.b.itemtype);
                        coerce_to_optional(node.a)
                    }
                    else {
                        // both optional or both non-optional
                        coerce_literal(node.b, node.a);
                        coerce_literal(node.a, node.b);
                    }
                    ensure_equal_types(node.a, node.b, opts,
                                       `operator '${node.op}'`);
                    copy_type({ type:'bool' }, node);
                }
            }
        }
        else if (node.op == '!')
        {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                truthy_node(node.a);
                unwrap_optional(node.a);
                ensure_type_is_one_of(node.a, [
                    { type:'bool' },
                ], opts, `operator '${node.op}`);
                copy_type({ type:'bool' }, node);
            }
        }
        else if (node.op == '#') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                if (equal_types(node.a, any_response)) {
                    throw new SyntaxError(node, `operator '#' does not work with response types. to unwrap responses, use <response>.errval and <response>.okval`);
                }
                unwrap_optional(node.a);
                optm_raise_child(node, "a");
            }
        }
        else if (node.op == 'expr_if') {
            _fill_types(node.expr, 'expr', scopes, opts);
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.expr, node.a, node.b)) {
                truthy_node(node.expr);
                if (! equal_types(node.expr, { type: 'bool' })) {
                    throw new TypeMismatchError(node, `expecting left-side of '?' expression to be bool but got ${node.a.type}`);
                }
                if (! equal_types(node.a, node.b)) {
                    if (is_type_none(node.a)) {
                        coerce_to_optional(node.b);
                    }
                    else if (is_type_none(node.b)) {
                        coerce_to_optional(node.a);
                    }
                    if (! equal_types(node.a, node.b)) {
                        throw new TypeMismatchError(node, `both 'then' and 'else' expressions of '?' must be the same type. got '${pretty_type(node.a)}' and '${pretty_type(node.b)}'`);
                    }
                }
                if (opts.optimize &&
                    node.expr.op=='lit' && node.expr.type=='bool')
                {
                    optm_raise_child(node, node.expr.val==true ? "a" : "b");
                }
                copy_type(node.a, node, node.b);
                if (equal_types(node.a, any_response)) {
                    merge_response_types(node.b, node);
                }
            }
        }
        else if (node.op == 'lit')
        {
            if (node.type == 'list') {
                // fill in list element types and enforce that all
                // list elements have the same type
                var max_size = -1n; // string, buff, list
                node.val.forEach((v, idx) => {
                    _fill_types(v, 'expr', scopes, opts);
                    if (check_type(opts, v)) {
                        if (v.size !== undefined && v.size > max_size)
                            max_size = v.size;
                        if (idx>0) {
                            if (! equal_types(node.val[0], v))
                                throw new TypeMismatchError(node, `list elements must all have the same type. element ${idx+1} is '${pretty_type(v)}', but expected '${pretty_type(node.val[0])}'`);
                            
                            // handle this likely clarity bug with maps
                            // eg: this causes a size error:
                            //    const l = [{ s:"efg"}, { s:"hijk" }]
                            // but this does not (longer string first):
                            //    const l = [{ s:"hijk" }, { s:"efg" }]
                            // straight strings, no maps is ok:
                            //    const l = [ "efg", "hijk" ]
                            // see foreach.crystal:foreachtest 6 and 8
                            
                            if (equal_types(v, { type:'map' })) {
                                // throws SizeError
                                equal_types_strict(node.val[0], v);
                            }

                        }
                    }
                });
                
                if (node.val.length==0) {
                    node.itemtype = { type:'-' };
                }
                else if (check_type(opts, node.val[0])) {
                    node.itemtype = copy_type(node.val[0], {});
                    if (max_size >= 0) node.itemtype.size = max_size;
                    if (type_is_one_of(node.itemtype, [
                            { type:'func' }, { type:'syscall_ref' }
                    ])) {
                        throw new NotSupportedError(node, `variables may not hold function references in Clarity`);
                    }
                }
            }
            
            else if (node.type == 'map') {
                var all_check = true;
                var maptype = {};
                for (var key in node.val) {
                    _fill_types(node.val[key], 'expr', scopes, opts);

                    if (check_type(opts, node.val[key])) {
                        maptype[key] = copy_type(node.val[key], {});
                        if (type_is_one_of(maptype[key], [
                            { type:'func' }, { type:'syscall_ref' }
                        ])) {
                            throw new NotSupportedError(node, `variables may not hold function references in Clarity`);
                        }
                    }
                    else {
                        // check_type will return false for references to
                        // functions that don't have a return type. to make
                        // a better error message, we have to look it up
                        // again
                        
                        if (node.val[key].op == 'id') {
                            var found = find_id(scopes, node.val[key].id, opts);
                            if (found &&
                                equal_types(found.node, { type: 'func' }))
                            {
                                throw new NotSupportedError(node.val[key], `variables may not hold function references in Clarity`);
                            }
                        }
                        
                        all_check = false;
                        
                    }
                }
                if (all_check) node.maptype = maptype;
            }
        }

        else if (node.op == 'sign-' || node.op=='sign+') {
            // negate
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                var negate = node.op=='sign-';
                if (!negate) {
                    optm_raise_child(node, "a");
                }
                else if (node.a.op == 'lit' &&
                         equal_types(node.a, { type:'int' }))
                {
                    node.a.val = -node.a.val;
                    optm_raise_child(node, "a");
                }
                else if (node.a.op == 'sign-') {
                    optm_raise_child(node, "a");
                    optm_raise_child(node, "a");
                }
                else {
                    unwrap_optional(node.a);
                    copy_type(node.a, node);
                }
                if (negate) {
                    ensure_type_is_one_of(node, [
                        { type:'int' }
                    ], opts, `operator '${node.op}'`);
                } else {
                    ensure_type_is_one_of(node, [
                        { type:'int' },
                        { type:'uint' }
                    ], opts, `operator '${node.op}'`);
                }
            }
        }
        
        else if (node.op == '+' ||
                 node.op == '-')
        {
            var a = node.multi[0];
            var b = node.multi[1];
            _fill_types(a, 'expr', scopes, opts);
            _fill_types(b, 'expr', scopes, opts);
            if (check_type(opts, a, b)) {
                unwrap_optional(a, b);
                //unwrap_response(a, b);
                coerce_literal(b, a);
                coerce_literal(a, b);
                ensure_equal_types(a, b, opts,
                                   `operator '${node.op}'`);
                if (node.op == '+') 
                    ensure_type_is_one_of(a, [
                        { type:'int' },
                        { type:'uint' },
                        { type:'string' },
                        { type:'string-ascii' }
                    ], opts, `operator '${node.op}'`);
                else
                    ensure_type_is_one_of(a, [
                        { type:'int' },
                        { type:'uint' },
                    ], opts, `operator '${node.op}'`);
                    
                copy_type(a, node, b);

                if (type_is_one_of(a, [{ type:'string' },
                                       { type:'string-ascii' }])) {
                    if (node.op=='+' && a.op == 'lit' && b.op == 'lit') {
                        // optimization: combine string literals
                        var newstring = a.val + b.val;
                        optm_move_node(a, node);
                        node.val = newstring;
                        node.size = newstring.length;
                    }
                    else {
                        if (a.size !== undefined && b.size !== undefined)
                            node.size = a.size + b.size;
                        else
                            delete node.size;
                    }
                }
                else if (node.op == a.op) {
                    // optimization: (- (- x y) z) => (- x y z). this
                    // doesn't work with strings because concat does
                    // not support more than 2 arguments
                    a.multi.push(b);
                    optm_move_node(a, node);
                }
            }
        }
        
        else if (node.op == '*' ||
                 node.op == '/')
        {
            var a = node.multi[0];
            var b = node.multi[1];
            _fill_types(a, 'expr', scopes, opts);
            _fill_types(b, 'expr', scopes, opts);
            if (check_type(opts, a, b)) {
                unwrap_optional(a, b);
                coerce_literal(b, a);
                coerce_literal(a, b);
                ensure_equal_types(a, b, opts,
                                   `operator '${node.op}'`);
                ensure_type_is_one_of(a, [
                    { type:'int' },
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                copy_type(a, node, b);
                if (node.op == a.op) {
                    // optimization: (* (* x y) z) => (* x y z)
                    a.multi.push(b);
                    optm_move_node(a, node);
                }
            }
        }

        else if (node.op == '<<' ||
                 node.op == '>>') {
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.a, node.b)) {
                coerce_literal(node.b, { type:'uint' });
                ensure_type_is_one_of(node.b, [
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                ensure_type_is_one_of(node.a, [
                    { type:'int' },
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                copy_type(node.a, node);
            }
        }

        else if (node.op == '~') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                unwrap_optional(node.a);
                ensure_type_is_one_of(node.a, [
                    { type:'int' },
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                copy_type(node.a, node);
            }
        }

        else if (node.op == '^' ||
                 node.op == '&' ||
                 node.op == '|')
        {
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.a, node.b)) {
                unwrap_optional(node.a, node.b);
                ensure_equal_types(node.a, node.b, opts,
                                   `operator '${node.op}'`);
                ensure_type_is_one_of(node.a, [
                    { type:'int' },
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                copy_type(node.a, node, b);
            }
        }

        else if (node.op == '%' ||
                 node.op == '**')
        {
            _fill_types(node.a, 'expr', scopes, opts);
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.a, node.b)) {
                unwrap_optional(node.a, node.b);
                coerce_literal(node.b, node.a);
                coerce_literal(node.a, node.b);
                ensure_equal_types(node.a, node.b, opts,
                                   `operator '${node.op}'`);
                ensure_type_is_one_of(node.a, [
                    { type:'int' },
                    { type:'uint' }
                ], opts, `operator '${node.op}'`);
                copy_type(node.a, node, b);
            }
        }
        else if (node.op == '&&' ||
                 node.op == '||' )
        {
            var a = node.multi[0];
            var b = node.multi[1];
            _fill_types(a, 'expr', scopes, opts);
            _fill_types(b, 'expr', scopes, opts);
            if (check_type(opts, a, b)) {
                truthy_node(a);
                truthy_node(b);
                ensure_type(a,{type:'bool'}, opts,
                            `operator '${node.op}'`);
                ensure_type(b,{type:'bool'}, opts,
                            `operator '${node.op}'`);

                var optimized = false;
                if (opts.optimize) {
                    var a_is_t=(a.op=='lit' && a.type=='bool' && a.val==true);
                    var a_is_f=(a.op=='lit' && a.type=='bool' && a.val==false);
                    var b_is_t=(b.op=='lit' && a.type=='bool' && b.val==true);
                    var b_is_f=(b.op=='lit' && a.type=='bool' && b.val==false);
                    optimized = true;
                    
                    if (node.op == '&&' && (a_is_f || b_is_f))
                        optm_reset_node(
                            node,
                            { op:'lit', type:'bool', val:false }
                        );
                
                    else if (node.op == '&&' && (a_is_t && b_is_t))
                        optm_reset_node(node, a);

                    else if (node.op == '&&' && a_is_t)
                        optm_reset_node(node, b);

                    else if (node.op == '&&' && b_is_t)
                        optm_reset_node(node, a);

                    else if (node.op == '||' && (a_is_t || b_is_t))
                        optm_reset_node(
                            node,
                            { op:'lit', type:'bool', val:true }
                        );
                
                    else if (node.op == '||' && (a_is_f && b_is_f))
                        optm_reset_node(node, a);
                    
                    else if (node.op == '||' && a_is_f)
                        optm_reset_node(node, b);

                    else if (node.op == '||' && b_is_f)
                        optm_reset_node(node, a);

                    else
                        optimized = false;
                }
                
                if (!optimized) {
                    copy_type(a, node, b);
                    if (opts.optimize && node.op == a.op) {
                        // optimization: (or (or x y) z) => (or x y z)
                        a.multi.push(b);
                        optm_move_node(a, node);
                    }
                }
            }
        }
        else if (node.op == 'id') {
            var found = find_id(scopes, node.id, opts);
            if (! found) {
                throw new SyntaxError(node, `no such id '${node.id}'`);
            }
            if (check_type(opts, found.node, `'${node.id}' has undetermined type`)) {
                copy_type(found.node, node);
                // probably should make 'func_def' and 'syscall' be 'decl'
                if (! found.node.func_def && ! found.node.syscall)
                    node.decl = found.node;                
            }
        }
        else if (node.op == '[]' || node.op == '.') {
            _fill_types_brackets(node, node_type, scopes, opts);
        }

        else if (node.op == 'func_call') {
            _fill_types_func_call(node, node_type, scopes, opts);
        }

        else if (node.op == 'foreach') {
            _fill_types_foreach(node, node_type, scopes, opts);
        }

        else if (node.op == 'anon_func_def') {
            _fill_types(node.args, 'func_def_args', scopes, opts);
            _fill_types(node.body, 'body', add_scope(scopes, node), opts);
            var return_type = get_fn_return_type(node);
            if (check_type(opts, return_type)) {
                copy_type(return_type, node);
            }
        }
        
        else if (node.op == 'int') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                unwrap_optional(node.a);
                if (equal_types(node.a, { type:'int' })) {
                    optm_raise_child(node, 'a');
                }
                else {
                    ensure_type(node.a, { type:'uint' }, opts,
                                `operator 'int'`);
                    copy_type({type:'int'}, node);
                }
            }
        }
        else if (node.op == 'uint') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                unwrap_optional(node.a);
                if (equal_types(node.a, { type:'uint' })) {
                    optm_raise_child(node, 'a');
                }
                else {
                    ensure_type(node.a, { type:'int' }, opts,
                                `operator 'uint'`);
                    copy_type({type:'uint'}, node);
                }
            }
        }
        else if (node.op == 'principal') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                unwrap_optional(node.a);
                if (equal_types(node.a, { type:'principal' })) {
                    optm_raise_child(node, 'a');
                }
                else {
                    ensure_type_is_one_of(node.a, [
                        { type:'string' },
                        { type:'string-ascii' }
                    ], opts);
                    if (node.a.op !== 'lit')
                        throw new SyntaxError(node, `principals given as expressions aren't supported by clarity`);
                    coerce_literal(node.a, { type:'principal' });
                    optm_raise_child(node, "a");
                }
            }
        }
        else if (node.op == 'optional') {
            _fill_types(node.a, 'expr', scopes, opts);
            if (check_type(opts, node.a)) {
                if (equal_types(node.a, optional_of_any_type)) {
                    optm_raise_child(node, 'a');
                    if (is_type_none(node)) {
                        // in the crystal language there is no such
                        // thing as optional(none)
                        throw new SyntaxError(node, `optional(none) is not allowable. just use 'none'`);
                    }
                }
                else if (type_is_one_of(node.a, [
                    { type:'func' },
                    { type:'syscall_ref' }
                ])) {
                    throw new SyntaxError(node, `function references cannot be optional`);
                }
                else {
                    copy_type({
                        type:'optional',
                        itemtype: copy_type(node.a, {})
                    }, node);
                }
            }
        }

        else if (node.op == '=' || node.op == '?=') {
            _fill_types(node.lval, 'expr', scopes, opts);
            _fill_types(node.rval, 'expr', scopes, opts);

            if (check_type(opts, node.lval, node.rval)) {
                if (type_is_one_of(node.rval, [
                    { type:'func' }, { type:'syscall_ref' }
                ])) {
                    throw new SyntaxError(stmt, `function references are not allowed`);
                }
                
                if (node.lval.op == 'id' && node.op == '=') {
                    if (node.lval.decl.protect == 'const')
                        throw new SyntaxError(node, `const is not assignable`);

                    if (node.lval.decl.access != 'datavar')
                        throw new InternalError(node, `invalid access type`);

                    ensure_equal_types(node.lval, node.rval, opts,
                                       `assignment`);
                    
                    // var-set always returns true
                    copy_type({ type:'bool' }, node);
                }

                else if (node.lval.op == '[]' && node.lval.expr.op=='id') {
                    var id = node.lval.expr;
                    var key = node.lval.bracket;
                    if (id.decl.protect == 'const')
                        throw new SyntaxError(node, `const is not assignable`);

                    if (id.decl.access != 'datamap')
                        throw new InternalError(node, `unhandled access type`);

                    // datamap keytype and valtype can't be optional
                    unwrap_optional(key, node.rval);

                    // individual keys and values can be optional
                    // types. keys have already been coerced/unwrapped
                    // by op=='[]'. values have not
                    coerce_lit_map_values(id.valtype, node.rval);
                    
                    if (! equal_types_strict(id.keytype, key)) 
                        throw new TypeMismatchError(node, `assignment. the key types '${pretty_type(id.keytype)}' and '${pretty_type(key)}' are incompatible`);
                    
                    if (! equal_types_strict(id.valtype, node.rval))
                        throw new TypeMismatchError(node, `assignment. the type accepted as the value '${pretty_type(id.valtype)}' is incompatible with '${pretty_type(node.rval)}'`);

                    // map-set always returns true
                    // map-insert returns true if inserted
                    copy_type({ type:'bool' }, node);
                }

                else {
                    throw new SyntaxError(node, `invalid assignment`);
                }
            }
        }

        else if (node.op == 'delete') {
            _fill_types(node.lval, 'expr', scopes, opts);
            if (check_type(opts, node.lval)) {
                if (node.lval.op == '[]' && node.lval.expr.op=='id') {
                    var id = node.lval.expr;
                    var key = node.lval.bracket;
                    if (id.decl.protect == 'const')
                        throw new SyntaxError(node, `can't change a const`);

                    if (id.decl.access != 'datamap')
                        throw new InternalError(node, `unhandled access type`);

                    if (! equal_types_strict(id.keytype, key)) 
                        throw new TypeMismatchError(node, `delete. the types '${pretty_type(id.keytype)}' and '${pretty_type(key)}' are incompatible`);
                    
                    // map-delete returns true if deleted
                    copy_type({ type:'bool' }, node);
                }

                else {
                    throw new SyntaxError(node, `invalid assignment`);
                }
            }
        }

        else if (node.op == '_countof') {
            _fill_types(node.id, 'expr', scopes, opts);
            if (check_type(opts, node.id)) {
                var countof_node = node.id;
                if (equal_types(node.id, optional_of_any_type)) {
                    countof_node = node.id.itemtype;
                }
                if (! is_sequence_type(countof_node)) {
                    throw new SyntaxError(node, `'_countof' argument of type '${pretty_type(node.id)}' is not a sequence type`);
                }
                var size = countof_node.size;
                optm_reset_node(node, {
                    op:'lit',
                    type:'uint',
                    val:size
                });
            }
        }

        else if (node.op == '_typeof') {
            _fill_types(node.id, 'expr', scopes, opts);
            if (check_type(opts, node.id)) {
                optm_reset_node(node, {
                    op:'lit',
                    type:'typedef',
                    typedef: node.id
                });
            }
        }
                
        else {
            throw new InternalError(node, `unhandled expr op=${node.op} node=${safeStringify(node)}`);
        }

    }

    opts.ctx_node_pop();
}






function update_return_type(context, type, return_type, return_type_nodes) {
    
    function handle_type_mismatch() {
        var n1 = return_type_nodes[0];
        var n2 = return_type_nodes[return_type_nodes.length -1];

        var n1_lineno = source_info(n1.context, 'line').line;
        throw new TypeMismatchError(n2.context, `there is more than one possible return type. got ${pretty_type(n1.type)} at line ${n1_lineno} and ${pretty_type(n2.type)}`);
    }
    
    if (!type || !type.type) return;
    if (!return_type.type) {
        copy_type(type, return_type);
        return_type_nodes.push({context, type});
    }
    else if (return_type.type == 'response' && type.type == 'response') {
        try {
            return_type_nodes.push({context, type});
            merge_response_types(type, return_type);
        } catch(e) {
            if (! (e instanceof TypeMismatchError)) throw e;
            handle_type_mismatch();
        }
    }
    else if (! equal_types(return_type, type)) {
        return_type_nodes.push({context, type});
        handle_type_mismatch();
    }
}


function get_fn_return_type(func_def) {
    var returns = get_body_return_type(func_def.body, func_def);
    if (! returns) {
        throw new UndeterminedTypeError(func_def, `function '${func_def.name}' does not return or has an undetermined type`);
    }
    // returns != null just means that the function definitively
    // returns. the return types embedded in 'if/elseif/else' won't be
    // included if one of the "arms" didn't use 'return'. eg:
    //   if () {                  <-- body_return_type==null
    //      if () { return 1; }   <-- body_return_type='int'
    //   }                            else_body_return_type=null
    //   return "a";              <-- 'returns' is a string[1]
    //

    var return_type = { type:null };
    var return_type_nodes = [ ];
    walk_cb(func_def.body, node => {
        if (node.op == 'func_def' || node.op == 'anon_func_def') {
            return false;
        }
        else if (node.op == 'return') {
            update_return_type(node, node, return_type, return_type_nodes);
        }
        else if (node.op == 'func_call' &&
                 equal_types(node.name, { type:'syscall_ref' }))
        {
            if (node.name.syscall._thrown_type)
                update_return_type(node, node.name.syscall._thrown_type(node),
                                   return_type, return_type_nodes);
        }
        return true;
    });
    if (! return_type.type )
        throw new InternalError(func_def, `no return type`);
    return return_type;
}


function get_body_return_type(body, return_required) {
    // a body has a return type only if ALL paths return
    //
    // ensure all return statements return the same type. it is not
    // recursive.
    //
    // return_required: if truthy, throw if no return
    // found. return_required should be the context node for error
    // messages
    var return_type = { type: null };
    var return_type_nodes = [];

    function set_return_type(context, type) {
        update_return_type(context, type, return_type, return_type_nodes);
    }

    function set_if_return_type(stmt) {
        if (stmt.body_return_type) {
            set_return_type(
                find_first_return(stmt.body) || stmt,
                stmt.body_return_type
            );
        }
        if (stmt.else_body_return_type) {
            set_return_type(
                find_first_return(stmt.else_body) || stmt,
                stmt.else_body_return_type
            );
        }
        if (stmt.elsif) {
            stmt.elsif.forEach(elsif => {
                if (elsif.body_return_type) {
                    set_return_type(
                        find_first_return(elsif.body) || stmt,
                        elsif.body_return_type
                    );
                }
            });
        }
    }

    var has_return = false;
    var first_if_without_return = null;
    body.forEach(stmt => {
        if (stmt.op == 'return') {
            has_return = true;
            set_return_type(stmt, stmt);
        }
        else if (stmt.op == 'if' || stmt.op == 'new_scope') {
            var all_bodies_return =
                stmt.body_return_type &&
                (stmt.else_body_return_type || stmt.op == 'new_scope');
            var some_body_returns =
                stmt.body_return_type || stmt.else_body_return_type;
            
            if (stmt.elsif) {
                stmt.elsif.forEach(elsif => {
                    all_bodies_return =
                        all_bodies_return && elsif.body_return_type;
                    some_body_returns =
                        some_body_returns || elsif.body_return_type;
                });
            }
                        
            if (all_bodies_return) {
                has_return = true;
                set_if_return_type(stmt);
            }
            else if (!first_if_without_return && some_body_returns) {
                first_if_without_return = stmt;
            }
        }
    });

    if (return_required) {
        if (!has_return) {
            if (first_if_without_return)
                throw new SyntaxError(first_if_without_return, `not all execution paths return`);
            else {
                throw new SyntaxError(return_required, `a return statement is required by the function`);
            }
        }

        if (return_type) {
            // optimization: remove unused variables
            body.forEach((stmt, idx) => {
                if (stmt.op == 'vardecl' && is_undetermined_type(stmt)) {
                    optm_reset_node(stmt, { op:'nop' });
                }
            });
        }
    }

    return return_type.type === null ? null : return_type;
}

