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
    DuplicateTraitFunctionError,
    TraitFunctionMismatchError,
    TraitNotImplementedError,
    SizeError
} from './exceptions.js';

import {
    equal_types,
    equal_types_strict,
    pretty_type,
    pretty_args
} from './ast_util.js';

import {
    add_comment
} from './ast_comments.js';


export function same_fn_declspec(func_def1, func_def2) {
    // func_def1: should be the trait item function decl
    // func_def2: should be the function implementing the trait item
    // return true if both function declarations have same signature
    
    // first check return types. we can't use pretty_type because
    // response<string[5],int> wouldn't match response<string[3],int>,
    // which should be allowed. Also, response<string[5],int> compared to
    // response<string[5],> with no err type, should be allowed.
    try {
        if (! equal_types_strict(func_def1, func_def2)) return false;
    } catch(e) {
        if (e instanceof SizeError) return false;
        throw e;
    }

    // the function arguments types need to match exactly
    return (
        func_def1.vis == func_def2.vis &&
        pretty_args(func_def1.args, true) == pretty_args(func_def2.args, true)
    );
}


export function check_if_function_implements_trait(func_def, scopes, opts) {
    scopes[0].body.forEach(definition => {
        if (definition.op == 'impl_trait' &&
            equal_types(definition.expr, { type: 'trait_def' }))
        {
            var trait_def = definition.expr.decl;
            trait_def.traits.forEach(trait_item => {
                if (trait_item.name == func_def.name) {

                    if (! same_fn_declspec(trait_item, func_def)) {
                        throw new TraitFunctionMismatchError(
                            func_def,
                            `function '${func_def.name}' has a different specification than the function defined by trait '${trait_def.id}'.\n\tThe function's is:\n\t\t'${func_def.vis} (${pretty_args(func_def.args, true)}) => ${pretty_type(func_def, true)}'\n\twhereas the trait expects\n\t\t'${trait_item.vis} (${pretty_args(trait_item.args, true)}) => ${pretty_type(trait_item, true)}'`
                        );
                    }
                    else {
                        add_comment(func_def, `;; part of trait '${trait_def.id}'`);
                        // mark as implemented
                        trait_item.impl = true;
                        func_def.trait_def = trait_def;
                    }
                }
            });
        }
    });
}


export function validate_trait_implementations(ast) {
    // 1. ensure there aren't two traits with the same name (and is
    //    being implemented).
    // 2. ensure all trait items have implementations

    var seen = {};
    ast.forEach(definition => {
        if (definition.op == 'impl_trait' &&
            equal_types(definition.expr, { type: 'trait_def' }))
        {
            var trait_def = definition.expr.decl;
            var not_implemented = [];
             
            trait_def.traits.forEach(trait_item => {
                if (! trait_item.impl)
                    not_implemented.push(trait_item.name);
                
                var cur = seen[trait_item.name];
                if (cur && !same_fn_declspec(cur.trait_item, trait_item)) {
                    throw new DuplicateTraitFunctionError(definition, `traits '${trait_def.id}' and '${cur.trait_def.id}' implement the function '${trait_item.name}' but have different arguments, return type or visibility`);
                }
                seen[trait_item.name] = {
                    trait_def,
                    trait_item
                };

            });

            if (not_implemented.length > 0) {
                throw new TraitNotImplementedError(definition, `one or more trait functions of '${trait_def.id} have not been implemented. implementations are needed for: ${not_implemented.join(',')}`);
            }
        }
    });
}

