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
    ArgumentError,
    NotSupportedError
} from './exceptions.js';

import {
    check_type,
    _fill_types
} from './ast_types.js';

import {
    list_of_any_type,
    copy_type,
    equal_types,
    unwrap_optional,
    pretty_type,
    safeStringify,
    dump,
} from './ast_util.js';

import {
    optm_raise_child,
} from './ast_optimize.js';


export function _fill_types_foreach(node, node_type, scopes, opts) {
    // { op:'foreach', type:'list', itemtype:null, a:$3, b:$5 }
    //
    // node.a is always an expression that must evaluate to a
    // list type
    //
    // node.b can be a anon_func_def or an id referring to a func
    //
    // { op:'anon-func-def', args:$2, body:$6, }
    
    _fill_types(node.a, 'expr', scopes, opts);

    if (check_type(opts, node.a)) {

        if (node.a.size == 0) {
            // special case - empty foreach list
            optm_raise_child(node, "a");
            return;
        }
        
        unwrap_optional(node.a);
        if (! equal_types(node.a, list_of_any_type)) {
            throw new SyntaxError(`the first argument to foreach must be a ${pretty_type(list_of_any_type)}, got ${pretty_type(node.a)}`);
        }
            
        if (node.b.op == 'anon_func_def') {
            // set the argument types in the anon_func_def
            if (node.b.args.length==0 || node.b.args.length>2)
                throw new ArgumentError(node, `anonymous function in foreach must have 1 or 2 arguments (for the item and optionally for the index)`);
            
            copy_type(node.a.itemtype, node.b.args[0]);
            if (node.b.args.length > 1) // optional index arg
                copy_type({ type:'uint' }, node.b.args[1]);
            
            _fill_types(node.b, 'expr', scopes, opts);
            if (check_type(opts, node.b)) {
                node.b.foreach_list_size = node.a.size;
                node.type = 'list'; // foreach returns a list
                node.itemtype = copy_type(node.b, {});
            }            
        }
            
        else {
            // because we have to use map and fold to do iteration,
            // neither of which have the ability to add additional
            // arguments, we will restrict use of non anonymous funcs
            // to only accepting a single argument, no closure, and
            // must return the same type as the itemtype of the input
            // list
            
            _fill_types(node.b, 'expr', scopes, opts);
            
            if (check_type(opts, node.b)) {
                if (! equal_types(node.b, { type:'func' })) {
                    throw new SyntaxError(`the second argument to foreach must be a function name or an anonymous function definition`);
                }
                
                var func_def = node.b.func_def;
                if (func_def.uses_closure) {
                    throw new NotSupportedError(node, `function '${func_def.name}' uses closure, which is not suppored with foreach. to use closure, use an anonymous function.`);
                }
                if (func_def.args.length != 1) {
                    throw new ArgumentError(node, `foreach function '${func_def.name}' should have a single argument of type '${pretty_type(node.a.itemtype)}'. to access the iteration index, use an anonymous function.`);
                }
                if (! equal_types(func_def, node.a.itemtype)) {
                    throw new ArgumentError(node, `foreach function '${func_def.name}' must return a '${pretty_type(node.a.itemtype)}'. to return a different type, use an anonymous function.`);
                }
                node.type = 'list'; // foreach returns a list
                node.itemtype = copy_type(func_def, {});
            }
        }
    }
}

