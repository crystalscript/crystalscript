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
    NotSupportedError,
    UndeterminedTypeError,
    UndefinedRuntimeTypeError,
} from './exceptions.js';

import {
    ClarList,
    ClarListLit
} from './ClarOutput.js';

import {
    mangle_foreach_anon
} from './ast_clarity_mangle.js';

import {
    optional_of_any_type,
    trait_of_any_type,
    any_response,
    equal_types,
    is_type_none,
    copy_type,
    pretty_type,
    contract_id_str_of_trait_type,
    safeStringify,
} from './ast_util.js';



export function to_clarity(ast, output_cb) {
    // add '(use-trait <name> <contract-id>.<trait-name>)' to the top
    // of the file. how?
    //
    // 1. find all function arguments that are type
    //    trait<.contract.trait-name>
    //
    // 2. add a (use-trait <uniqid> ...) for all unique trait names
    //
    // 3. change arguments from trait<*> to clarity "<uniqid>" syntax

    var generated_trait_names = {}; // key=contract-id.trait-name => name
    ast.forEach(definition => {
        if (definition.op != 'anon_func_def' &&
            definition.op != 'func_def' &&
            definition.op != "trait_def")
        {
            return;
        }
        
        var funcs = definition.op == 'trait_def' ?
            definition.traits :
            [ definition ];
        
        funcs.forEach(func => {
            if (func.op != 'func_def' &&
                func.op != 'anon_func_def' &&
                func.op != 'extern_func_def')
            {
                return;
            }
            
            func.args.forEach(arg => {
                
                if (equal_types(arg, trait_of_any_type)) {
                    var str = contract_id_str_of_trait_type(arg);
                    var clar_trait_name = generated_trait_names[str];
                    if (! clar_trait_name) {
                        clar_trait_name = str.replaceAll('.','-');
                        if (clar_trait_name.substr(0,1)=='-')
                            clar_trait_name = clar_trait_name.substr(1);
                        generated_trait_names[str] = clar_trait_name;
                    }
                    arg.clar_itemtype = clar_trait_name;
                }
            });
        });
    });
    
    for (var contract_id_str in generated_trait_names) {
        var name = generated_trait_names[contract_id_str];
        var use_trait = new ClarList(null, 'use-trait', name, contract_id_str);
        output_cb(`${use_trait}\n`);
    }
    if (Object.keys(generated_trait_names).length>0) output_cb(`\n`);


    // process the rest of the top-level definitions
    //
    // to support 'foreach' we have to mangle anonymous functions
    // before their globalized form is realized
    ast.forEach(definition => {
        if (definition.op == 'anon_func_def' &&
            definition.genesis_op == 'foreach')
        {
            // this is an anonymous function as part of a foreach
            // statement that was globalized. we have to mangle it to
            // support foreach in clarity
            mangle_foreach_anon(definition);
        }
        
        if (definition.op == 'func_def' || definition.op == 'anon_func_def') {
            output_cb(`${c2c_func_def(definition)}\n\n`);
        }
        else if (definition.op == 'vardecl') {
            output_cb(`${c2c_define_const(definition)}\n\n`);
        }
        else if (definition.op == 'persist') {
            output_cb(`${c2c_persist_item(definition)}\n\n`);
        }
        else if (definition.op == 'trait_def') {
            output_cb(`${c2c_trait_def(definition)}\n\n`);
        }
        else if (definition.op == 'impl_trait') {
            output_cb(`${c2c_impl_trait(definition)}\n\n`);
        }
        else if (definition.op == 'declare_extern') {
            // nothing to do
        }
        else {
            throw new InternalError(`unhandled definition=${safeStringify(definition)}`);
        }
    });
}


function c2c_typedef(typedef) {
    if (typedef.type == 'int' ||
        typedef.type == 'uint' ||
        typedef.type == 'bool' ||
        typedef.type == 'principal')
    {
        return new ClarListLit(null, typedef.type);
    }
    else if (typedef.type == 'list')
    {
        if (typedef.itemtype.type == '-') {
            return new ClarList(null, 'list');
        }
        else {
            return new ClarList(
                null,
                'list',
                typedef.size,
                c2c_typedef(typedef.itemtype)
            );
        }
    }
    else if (typedef.type == 'buff')
    {
        return new ClarList(null, 'buff', typedef.size);
    }
    else if (typedef.type == 'string') {
        return new ClarList(null, 'string-utf8', typedef.size);
    }
    else if (typedef.type == 'response') {
        return new ClarList(
            null,
            'response',
            // something is required for both ok and err types
            // leaving blank or using 'none' does not work
            c2c_typedef(typedef.oktype || typedef.errtype),
            c2c_typedef(typedef.errtype || typedef.oktype),
        );
    }
    else if (typedef.type == 'map') {
        var output = [];
        for (var key in typedef.maptype) {
            var valtype = c2c_typedef(typedef.maptype[key]);
            output.push(`${key}:${valtype}`);
        }
        return new ClarListLit(null, `{${output.join(',')}}`);
    }
    else if (typedef.type == 'optional') {
        return new ClarList(
            null,
            'optional',
            c2c_typedef(typedef.itemtype)
        );
    }
    else if (typedef.type == 'trait') {
        if (typedef.clar_itemtype) {
            return new ClarListLit(null, `<${typedef.clar_itemtype}>`);
        }
        else {
            throw new InternalError(typedef, `missing clar trait conversion`);
        }
    }
    else {
        throw new InternalError(typedef, `unknown typedef`);
    }
}

function c2c_lit(expr) {
    if (expr.subtype == 'keyword')
        return new ClarListLit(expr, expr.val);
    else if (expr.type == 'none')
        return new ClarListLit(expr, 'none');
    else if (expr.type == 'string')
        return new ClarListLit(expr, `u"${expr.val}"`);
    else if (expr.type == 'int')
        return new ClarListLit(expr, expr.val);
    else if (expr.type == 'uint')
        return new ClarListLit(expr, 'u' + expr.val);
    else if (expr.type == 'bool')
        return new ClarListLit(expr, expr.val.toString());
    else if (expr.type == 'buff')
        return new ClarListLit(expr, '0x' + expr.val.toString('hex'));
    else if (expr.type == 'map') {
        // maps have values that are expressions
        var output = [];
        var map = expr.val;
        for (var key in map) {
            var val = c2c_expr(map[key]);
            output.push(`${key}:${val}`);
        }
        return new ClarListLit(expr, `{${output.join(',')}}`);
    }
    else if (expr.type == 'list') {
        // lists contain expressions
        var lb = new ClarList(expr, 'list');
        expr.val.forEach(item => {
            lb.add(c2c_expr(item));
        });
        return lb;
    }
    else if (expr.type == 'principal') {
        if (expr.val.substr(0,1) == ".") {
            // short-form contract principal
            return new ClarListLit(expr, expr.val);
        }
        // precede name with clarity principal designator single-quote
        return new ClarListLit(expr, `'${expr.val}`);
    }
    else {
        throw new InternalError(expr, `unhandled literal '${safeStringify(expr)}'`);
    }
}

function c2c_func_call(func_call) {
    var func_def = func_call.name.func_def || func_call.name.syscall;
    var name = func_def.clarity_name || func_def.name;
    var lb = new ClarList(func_call, name);
    func_call.args.forEach(arg => {
        lb.add(c2c_expr(arg));
    });
    return lb;
}


function c2c_expr(expr) {
    if (expr.op == 'lit') {
        return c2c_lit(expr);
    }
    else if (expr.op == 'id') {
        if (!expr.decl || !expr.decl.access) {
            return new ClarListLit(expr, expr.id);
        }
        else if (expr.decl.access == 'datavar') {
            return new ClarList(expr, 'var-get', expr.id);
        }
        else if (expr.decl.access == 'ft') {
            return new ClarListLit(expr, expr.id);
        }
        else if (expr.decl.access == 'nft') {
            return new ClarListLit(expr, expr.id);
        }
        else if (expr.decl.access == 'contract') {
            return c2c_expr(expr.decl.contract_id);
        }
        else {
            throw new InternalError(expr, `unhandled access '${expr.decl.access}'`);
        }
    }
    else if (expr.op == '[]' || expr.op == '.') {
        if (expr.expr.op == 'id' && expr.expr.decl.access == 'datamap') {
            // acccess a datamap
            return new ClarList(
                expr,
                'map-get?',
                new ClarListLit(null, expr.expr.id),
                c2c_expr(expr.bracket)
            );
        }
        
        if (equal_types(expr.bracket, { type:'string' })) {
            
            if (equal_types(expr, { type:'trait_def' }))
            {
                // type 'trait_def' was bubbled up by '.'  handler in
                // ast_types_brackets.js which also ensured bracket.op
                // is 'lit'

                // contract id of the extern
                var extern_contract_id = expr.decl.contract_id.val;
                // contract id extended with trait name
                var contract_id_lb = c2c_lit({
                    type:'principal',
                    val:  extern_contract_id + '.' + expr.bracket.val
                });
                return contract_id_lb;
            }

            if (expr.bracket.op != 'lit') {
                throw new NotSupportedError(expr, `clarity does not support indirect map lookups, a literal string is required`);
            }
            
            if (equal_types(expr.expr, any_response)) {
                // access a response
                var unwrap = 'unwrap-panic';
                if (expr.bracket.val == 'errval') unwrap = 'unwrap-err-panic'
                else if (expr.bracket.val != 'okval')
                    throw new InternalError(`bad key`);
                return new ClarList(
                    expr,
                    unwrap,
                    c2c_expr(expr.expr)
                );
            }
            else if (equal_types(expr.expr, { type:'extern_decl' })) {
                throw new InternalError(expr.expr, `not supported`);
            }
            else {
                // access a map
                return new ClarList(
                    expr,
                    'get',
                    expr.bracket.val, //c2c_expr(expr.bracket),
                    c2c_expr(expr.expr)
                );
            }
        }
        else {
            // access a list
            return new ClarList(
                expr,
                'unwrap-panic',
                new ClarList(
                    null,
                    'element-at',
                    c2c_expr(expr.expr),
                    c2c_expr(expr.bracket)
                )
            );
        }
    }
    else if (expr.op == 'sign-') {
        // sign+ should have been optimized away
        return new ClarList(
            expr,
            '-',
            c2c_expr(expr.a)
        );
    }
    
    else if (expr.op == '+' ||
             expr.op == '-' ||
             expr.op == '*' ||
             expr.op == '/')
    {
        if (expr.op == '+' && equal_types(expr, { type:'string' })) {
            return new ClarList(
                expr,
                'concat',
                c2c_expr(expr.multi[0]),
                c2c_expr(expr.multi[1])
            );
        }
        else {
            var lb = new ClarList(expr, expr.op);
            expr.multi.forEach(item => lb.add(c2c_expr(item)));
            return lb;
        }
    }
    
    else if (expr.op == '>=' ||
             expr.op == '<=' ||
             expr.op == '<' ||
             expr.op == '>')
    {
        return new ClarList(
            expr,
            expr.op,
            c2c_expr(expr.a),
            c2c_expr(expr.b)
        );
    }
    else if (expr.op == '%') {
        return new ClarList(
            expr,
            'mod',
            c2c_expr(expr.a),
            c2c_expr(expr.b)
        );
    }
    else if (expr.op == '**') {
        return new ClarList(
            expr,
            'pow',
            c2c_expr(expr.a),
            c2c_expr(expr.b)
        );
    }
    else if (expr.op == '^') {
        return new ClarList(
            expr,
            'xor',
            c2c_expr(expr.a),
            c2c_expr(expr.b)
        );
    }
    
    else if (expr.op == '==') {
        if (is_type_none(expr.a) &&
            equal_types(expr.b, optional_of_any_type)) {
            return new ClarList(
                expr,
                'is-none',
                c2c_expr(expr.a),
            );
        }
        else if (equal_types(expr.a, optional_of_any_type) &&
                 is_type_none(expr.b)) {
            return new ClarList(
                expr,
                'is-none',
                c2c_expr(expr.a),
            );
        }
        else {
            return new ClarList(
                expr,
                'is-eq',
                c2c_expr(expr.a),
                c2c_expr(expr.b)
            );
        }
    }
    
    else if (expr.op == '!=') {
        if (is_type_none(expr.a) &&
            equal_types(expr.b, optional_of_any_type)) {
            return new ClarList(
                expr,
                'not',
                new ClarList(
                    null,
                    'is-none',
                    c2c_expr(expr.a),
                )
            );
        }
        else if (equal_types(expr.a, optional_of_any_type) &&
                 is_type_none(expr.b)) {
            return new ClarList(
                expr,
                'not',
                new ClarList(
                    null,
                    'is-none',
                    c2c_expr(expr.a),
                )
            );
        }
        else {
            return new ClarList(
                expr,
                'not',
                new ClarList(
                    null,
                    'is-eq',
                    c2c_expr(expr.a),
                    c2c_expr(expr.b)
                )
            );
        }
    }
    
    else if (expr.op == '&&') {
        var lb = new ClarList(expr, 'and');
        expr.multi.forEach(item => lb.add(c2c_expr(item)));
        return lb;
    }
    else if (expr.op == '||') {
        var lb = new ClarList(expr, 'or');
        expr.multi.forEach(item => lb.add(c2c_expr(item)));
        return lb;
    }
    else if (expr.op == '!') {
        return new ClarList(
            expr,
            'not',
            c2c_expr(expr.a)
        );
    }
    else if (expr.op == 'expr_if') {
        return new ClarList(
            expr,
            'if',
            c2c_expr(expr.expr),
            c2c_expr(expr.a),
            c2c_expr(expr.b)
        );
    }
    else if (expr.op == 'func_call') {
        return c2c_func_call(expr);
    }
    else if (expr.op == 'foreach') {
        var func_def = expr.b.func_def;

        if (! func_def.anonymous) {
            // special case -- no closure, no index, correct return type
            //  ... use map
            return new ClarList(
                expr,
                'map',
                expr.b.id,
                c2c_expr(expr.a));
        }

        // build the "initial value" for "fold", which, because of
        // mangle_foreach_anon(), is now a maptype.

        var arg1 = func_def.args[1];
        var initial_value = {
            index: { op:'lit', type:'uint', val:0n },
            results: { op:'lit', type:'list', val:[], itemtype:{type:'-'} },
        };
        if (! arg1.maptype.index) delete initial_value.index;
        if (arg1.maptype.closure_vars) {
            initial_value.closure_vars = {
                op: 'lit',
                type: 'map',
                val: {}
            };
            for (var key in arg1.maptype.closure_vars.maptype) {
                initial_value.closure_vars.val[key] = {
                    op: 'id',
                    id: arg1.maptype.closure_vars.maptype[key].closure,
                };
            }
        }
        
        var lb = new ClarList(
            expr,
            'get',
            'results',
            new ClarList(
                null,
                'fold',
                expr.b.id,
                c2c_expr(expr.a),
                c2c_lit({ type:'map', val:initial_value })
            )
        );
        return lb;
    }
    else if (expr.op == 'int' ||
             expr.op == 'uint')
    {
        return new ClarList(
            expr,
            'to-' + expr.op,
            c2c_expr(expr.a)
        );
    }
    else if (expr.op == 'optional') {
        return new ClarList(
            expr,
            'some',
            c2c_expr(expr.a)
        );
    }

    else if (expr.op == '=' || expr.op =='?=') {
        if (expr.lval.op == 'id') {
            // datavar
            if (expr.lval.decl.access != 'datavar')
                throw new InternalError(`expected datavar`);
            return new ClarList(
                expr,
                'var-set',
                expr.lval.id,
                c2c_expr(expr.rval)
            );
        }
        else if (expr.lval.op == '[]') {
            // datamap
            if (!expr.lval.expr.decl ||
                expr.lval.expr.decl.access != 'datamap')
                throw new InternalError(`expected datamap`);
            return new ClarList(
                expr,
                expr.op == '=' ? 'map-set' : 'map-insert',
                expr.lval.expr.id,
                c2c_expr(expr.lval.bracket),
                c2c_expr(expr.rval)
            );
        }
        else {
            throw new InternalError(`unhandled assignment`);
        }
    }

    else if (expr.op == 'delete') {
        // datamap
        if (!expr.lval.expr.decl ||
            expr.lval.expr.decl.access != 'datamap')
            throw new InternalError(`expected datamap`);
        return new ClarList(
            expr,
            'map-delete',
            expr.lval.expr.id,
            c2c_expr(expr.lval.bracket)
        );
    }

    else {
        throw new InternalError(expr, `unhandled expression op=${expr.op}`);
    }
}


function c2c_body(is_parent_last_stmt, body) {
    // body: an Array of vars_then_stmts

    var output=[]; // non-vars
    var vars = [];
    
    body.forEach((stmt, idx) => {
        var is_last_stmt = ( (is_parent_last_stmt || is_parent_last_stmt===null) && idx == body.length-1 );

        if (stmt.op == 'vardecl') {
            vars.push(new ClarList(
                stmt,
                stmt.id,
                c2c_expr(stmt.expr)
            ));
        }

        else if (stmt.op == 'new_scope') {
            output.push(
                c2c_body(is_last_stmt, stmt.body)
            );
        }

        else if (stmt.op == 'if') {

            var clarlists = [];
            
            function true_body(body) {
                var b = c2c_body(false, body);
                var no_add_true = false;
                if (b instanceof ClarList) {
                    var cmp = b.bottom();
                    if (cmp == 'let' || cmp == 'begin') {
                         cmp = b.top().bottom();
                    }
                    if (cmp == 'asserts!') no_add_true = true;
                }

                if (no_add_true) return b.fmt_nl();
                
                // add true                    
                if ((b instanceof ClarList) && body.length>1)
                    return b.add(
                        new ClarListLit(null, 'true').fmt_nl()
                    ).fmt_nl();
                else
                    return new ClarList(
                        null,
                        'begin',
                        b.fmt_nl(3),
                        new ClarListLit(null, 'true').fmt_nl()
                    ).fmt_nl(3);
            }

            clarlists.push(
                new ClarList(
                    stmt,
                    'and',
                    c2c_expr(stmt.expr),
                    true_body(stmt.body).fmt_nl(5)
                )
            );
            
            if (stmt.elsif) {                
                stmt.elsif.forEach(elsif => {
                    clarlists.push(
                        new ClarList(
                            null,
                            'and',
                            c2c_expr(elsif.expr),
                            true_body(elsif.body)
                        ).fmt_nl()
                    );
                });
            }

            var final_else = null;
            if (stmt.else_body) {
                if (is_last_stmt) {
                    final_else =
                        c2c_body(is_last_stmt, stmt.else_body).fmt_nl();
                }
                else {
                    clarlists.push(true_body( stmt.else_body ));
                }
            }
            
            if (clarlists.length > 1) {
                output.push(new ClarList(null, 'or', ...clarlists));
            }
            else {
                output.push(clarlists[0]);
            }
            if (final_else) {
                if ((final_else instanceof ClarList) &&
                    final_else.is_clar_expr('begin'))
                {
                    output.push(...final_else.items.slice(1));
                }
                else
                    output.push(final_else);
            }
            
        }

        else if (stmt.op == 'return') {
            if (is_last_stmt) {
                var lb = c2c_expr(stmt.expr);
                lb.prepend_comments(stmt.c);
                output.push(lb);
            }
            else {
                output.push(new ClarList(
                    stmt,
                    'asserts!',
                    'false',
                    c2c_expr(stmt.expr)
                ));
                stmt.clar_type = { type: 'bool' };
            }
        }
        
        else {
            output.push(c2c_expr(stmt));
        }
       
    });

    output.forEach(o => o.fmt_nl());

    if (vars.length > 0) {
        // (let ((name1 expr1) (name2 expr2) ...) body1 body2 ...)
        vars.forEach((v,idx) => {
            if (idx>0) v.fmt_nl();
        });
        return new ClarList(
            null,
            'let',
            new ClarList(null, vars),
            output
        ).fmt_nl();
    }
    else {
        if (output.length == 1) {
            return output[0];
        }
        else {
            // (begin body1 body2 ...)
            output[0].fmt_nl(3);
            var lb = new ClarList(
                null,
                'begin',
                output
            ).fmt_nl(3);
            output[0].move_comments(lb);
            return lb;
        }
    }
}


function c2c_func_def(func_def) {
    // signature: (define-read-only (function-name (arg-name-0 arg-type-0) (arg-name-1 arg-type-1) ...) function-body)
    var lb = new ClarList(
        func_def,
        'define-' + func_def.vis
    );
    //output_cb(`;; ${pretty_type(definition)}\n`);
    var fn_name = new ClarList(
        null,
        func_def.name
    );
    func_def.args.forEach(arg => {
        fn_name.add(new ClarList(
            arg,
            arg.name,
            c2c_typedef(arg)
        ));
    });
    lb.add(fn_name);
    lb.add(c2c_body(null, func_def.body).fmt_nl(3));
    return lb;
}


function c2c_define_const(definition) {
    return new ClarList(
        definition,
        'define-constant',
        definition.id,
        c2c_expr(definition.expr)
    );
}

function c2c_persist_item(definition) {
    if (definition.type == 'datamap') {
        return new ClarList(
            definition,
            'define-map',
            definition.id,
            c2c_typedef(definition.keytype),
            c2c_typedef(definition.valtype)
        );
    }
    
    else if (definition.type == 'ft') {
        var lb = new ClarList(
            definition,
            'define-fungible-token',
            definition.id
        );
        if (definition.total_supply !== null)
            lb.add(c2c_expr(definition.total_supply));
        return lb;
    }
    
    else if (definition.type == 'nft') {
        return new ClarList(
            definition,
            'define-non-fungible-token',
            definition.id,
            c2c_typedef(definition.tokenidtype)
        );
    }
    
    else {
        return new ClarList(
            definition,
            'define-data-var',
            definition.id,
            c2c_typedef(definition),
            c2c_expr(definition.initial_val)
        );
    }
}

function c2c_trait_def(definition) {
    var lb = new ClarList(
        definition,
        'define-trait',
        definition.id,
    );
    var traits = new ClarList(null);
    definition.traits.forEach(trait_def => {
        var fn = new ClarList(null, trait_def.name).fmt_nl(-2);
        var fn_args = new ClarList(null).fmt_nl();
        trait_def.args.forEach(arg => {
            fn_args.add(c2c_typedef(arg));
        });
        fn.add(fn_args, c2c_typedef(trait_def).fmt_nl());
        traits.add(fn);
    });
    lb.add(traits);
    return lb;
}

function c2c_impl_trait(definition) {
    return new ClarList(
        definition,
        'impl-trait',
        c2c_expr(definition.expr)
    );
}


