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
    NotSupportedError,
    TypeMismatchError,
    MapKeyNotFoundError,
    SyntaxError,
    UnsetReponseTypeError
} from './exceptions.js';

import {
    check_type,
    _fill_types
} from './ast_types.js';

import {
    optional_of_any_type,
    list_of_any_type,
    trait_of_any_type,
    any_response,
    ok_response_of_any_type,
    err_response_of_any_type,
    copy_type,
    copy_okerr_type,
    equal_types,
    equal_types_strict,
    type_is_one_of,
    coerce_literal,
    unwrap_optional,
    coerce_lit_map_values,
    pretty_type,
} from './ast_util.js';

import {
    optm_raise_child,
    optm_reset_node
} from './ast_optimize.js';

import {
    make_syscall,
    lookup_syscall
} from './ast_syscall.js';

import {
    lookup_internal_call
} from './ast_internal_call.js';



export function _fill_types_brackets(node, node_type, scopes, opts) {
    if (node.expr !== null)
        _fill_types(node.expr, 'expr', scopes, opts);
    
    // special case handling for contract id's
    if (node.op == '.') {
        // with dot operator, the grammer ensures the bracket can
        // only be a literal string
        if (node.expr === null) {
            // beginning of a short-form contract_id
            node.bracket.val = '.' + node.bracket.val;
            optm_raise_child(node, 'bracket');
            copy_type({ type:'principal' }, node);
            return;
        }
        else if (equal_types(node.expr, { type:'principal' })) {
            // extending the current contract id
            node.expr.val += '.' + node.bracket.val;
            optm_raise_child(node, 'expr');
            return;
        }
    }

    // not a special contract id case - we're dereferencing something
    
    _fill_types(node.bracket, 'expr', scopes, opts);
    
    if (check_type(opts, node.expr, node.bracket)) {
        const valid_list_types = [
            list_of_any_type,
            { type:'optional', itemtype:list_of_any_type }
        ];
        const valid_map_types = [
            { type:'map' },
            { type:'optional', itemtype:{ type:'map' } },
        ];

        var is_string = equal_types(node.expr, { type:'string' });
        var is_list = type_is_one_of(node.expr, valid_list_types);
        var is_map = type_is_one_of(node.expr, valid_map_types);
        var is_datamap = equal_types(node.expr, { type:'datamap' });
        var is_response = equal_types(node.expr, any_response);
        var is_externdecl = equal_types(node.expr, { type:'extern_decl' });
        var is_trait = equal_types(node.expr, trait_of_any_type);
        var is_trait_def = equal_types(node.expr, { type:'trait_def' });
        
        if (!is_string && !is_list && ! is_map && !is_datamap && !is_response && !is_externdecl && !is_trait && !is_trait_def) {
            throw new TypeMismatchError(node, `cannot operate on type '${pretty_type(node.expr)}' with '${node.op}'`);
        }
            
        coerce_literal(node.bracket, { type:'uint' });
        unwrap_optional(node.bracket);

        if (is_string && node.op=='.' &&
            equal_types(node.bracket, { type:'string' }))
        {
            // with dot operator, the grammer ensures the bracket can
            // only be a literal string
            if (node.bracket.val == 'ascii') {
                if (node.expr.op != 'lit')
                    throw new NotSupportedError(expr, `must be a literal string to use ascii()`);
                optm_reset_node(node, {
                    op:'id',
                    id:'_utf8-to-ascii',
                    type: 'syscall_ref',
                    bind: [ node.expr ],
                    syscall: lookup_internal_call('_utf8-to-ascii')
                });
            }
            else {
                throw new MapKeyNotFoundError(node, `operator '${node.op}'. invalid key '${node.bracket.val}'`);
            }
        }
                                                          
        else if (is_list && equal_types(node.bracket, { type:'uint' })) {
            if (equal_types(node.expr, optional_of_any_type)) {
                unwrap_optional(node.expr);
            }
            // clarity element-at returns an optional, but we
            // use unwrap-panic with it
            copy_type(node.expr.itemtype, node);
        }
        
        else if (is_map && equal_types(node.bracket, { type:'string' })) {
            // clarity 'get' only accepts a literal!!!
            if (node.bracket.op !== 'lit')
                throw new NotSupportedError(node, `clarity does not support indirect map lookups, a literal string is required`);
            
            // clarity 'get' returns an optional if the map is
            // an optional, otherwise it returns the type of
            // the key that's retrieved
            
            if (equal_types(node.expr, optional_of_any_type)) {
                var maptype = node.expr.itemtype.maptype;
                if (!maptype[node.bracket.val]) {
                    throw new MapKeyNotFoundError(node.expr, `map key '${node.bracket.val}' not found in map (valid keys are ${Object.keys(maptype).join(',')})`);
                }
                copy_type({
                    type:'optional',
                    itemtype:maptype[node.bracket.val]
                }, node);
            }
            else {
                var maptype = node.expr.maptype;
                if (!maptype[node.bracket.val]) {
                    throw new MapKeyNotFoundError(node.expr, `map key '${node.bracket.val}' not found in map (valid keys are ${Object.keys(maptype).join(',')})`);
                }
                copy_type(maptype[node.bracket.val], node);
            }
        }

        else if (is_datamap) {
            if (node.op == '.') {
                throw new SyntaxError(node, `dot notation cannot be used with datamaps`);
            }
            if (equal_types(node.bracket, { type:'map' })) {
                // individual key values can be optional types
                coerce_lit_map_values(node.expr.keytype, node.bracket);
            }
            else {
                coerce_literal(node.bracket, node.expr.keytype);
            }
                
            if (!equal_types_strict(node.expr.keytype, node.bracket)) {
                throw new TypeMismatchError(node.bracket, `map key of type '${pretty_type(node.bracket)}' is incompatible with datamap's type '${pretty_type(node.expr.keytype)}'`);
            }
            // clarity map-get? returns an optional
            copy_type({ type:'optional', itemtype:node.expr.valtype}, node);
        }

        else if (is_response && equal_types(node.bracket, { type:'string' })) {
            if (node.bracket.op != 'lit') {
                throw new NotSupportedError(node, `operator '${node.op}'. indirect access to response properties is not supported.`);
            }
            
            var has_ok = equal_types(node.expr, ok_response_of_any_type);
            var has_err = equal_types(node.expr, err_response_of_any_type);
            
            if (node.bracket.val == 'okval') {
                if (has_ok)
                    copy_okerr_type(node.expr.oktype, node);
                else
                    throw new UnsetReponseTypeError(node, `operator '${node.op}'. response object never obtains an ok value, and therefore 'ok' cannot be accessed`);
            }
            
            else if (node.bracket.val == 'errval') {
                if (has_err)
                    copy_okerr_type(node.expr.errtype, node);
                else
                    throw new UnsetReponseTypeError(node, `operator '${node.op}'. response object never obtains an err value, and therefore 'err' cannot be accessed`);
            }

            else if (node.bracket.val == 'isok') {
                optm_reset_node(node, {
                    op:'id',
                    id:'is-ok',
                    type: 'syscall_ref',
                    bind: [ node.expr ],
                    syscall: lookup_syscall('is-ok')
                });
            }
            
            else if (node.bracket.val == 'iserr') {
                optm_reset_node(node, {
                    op:'id',
                    id:'is-err',
                    type: 'syscall_ref',
                    bind: [ node.expr ],
                    syscall: lookup_syscall('is-err')
                });
            }
            
            else {
                throw new MapKeyNotFoundError(node, `operator '${node.op}'. invalid key '${node.bracket.val}'. only 'isok', 'iserr', 'okval', 'errval' are available in responses`);
            }

        }

        else if (is_externdecl && equal_types(node.bracket, { type:'string' })) {
            if (node.bracket.op != 'lit') {
                throw new NotSupportedError(node, `operator '${node.op}'. indirect access to extern declarations is not supported.`);
            }
            var found = false;
            for (var idx=0; idx<node.expr.decl.defs.length; idx++) {
                var def = node.expr.decl.defs[idx];
                if (def.op=='extern_func_def' && def.name==node.bracket.val ||
                    def.op=='extern_trait_def' && def.id==node.bracket.val ||
                    def.op=='extern_trait_def_impl' && (
                        def.id==node.bracket.val ||
                        def.impl_contract_id.val == node.bracket.val
                    ))
                {
                    found=def;
                    break;
                }
            }
            if (!found) {
                throw new MapKeyNotFoundError(node.expr, `'${node.bracket.val}' not found in extern declaration '${node.expr.id}' imported from '${node.expr.decl.import_path}'`);
            }
            if (found.op == 'extern_func_def')
                copy_type({ type:'func', func_def:found }, node);
            
            else if (found.op == 'extern_trait_def')
                copy_type({ type:'trait_def', decl:found }, node)
            ;
            else if (found.op == 'extern_trait_def_impl')
                copy_type({ type:'trait_def_impl', decl:found }, node);
            
            else
                throw new NotSupportedError(found, `'${found.op}' is not a supported extern type`);
        }

        else if (is_trait && equal_types(node.bracket, { type:'string' })) {
            if (node.bracket.op != 'lit') {
                throw new NotSupportedError(node, `operator '${node.op}'. indirect access to trait declarations is not supported.`);
            }
            var found = false;
            var traits = node.expr.itemtype.decl.traits;
            for (var idx=0; idx<traits.length; idx++) {
                var def = traits[idx];
                if (def.name == node.bracket.val)
                {
                    found=def; // op=extern_func_def
                    break;
                }
            }
            if (!found) {
                throw new MapKeyNotFoundError(node.expr, `'${node.bracket.val}' not found in trait '${node.expr.id}'`);
            }
            copy_type({
                type:     'func',
                func_def:  found,
                func_impl: node.expr,
            }, node);
        }        

        else if (is_trait_def && equal_types(node.bracket, { type:'string' })) {
            if (node.bracket.op != 'lit') {
                throw new NotSupportedError(node, `operator '${node.op}'. indirect access to trait declarations is not supported.`);
            }
            var found = false;
            var traits = node.expr.decl.traits;
            for (var idx=0; idx<traits.length; idx++) {
                var def = traits[idx];
                if (def.name == node.bracket.val)
                {
                    found=def; // op=extern_func_def
                    break;
                }
            }
            if (!found) {
                throw new MapKeyNotFoundError(node.expr, `'${node.bracket.val}' not found in trait '${node.expr.id}'`);
            }
            copy_type({ type:'func', func_def:found }, node);
        }        

        else {
            throw new TypeMismatchError(node, `not a valid index type '${pretty_type(node.bracket)}' for '${pretty_type(node.expr)}'`);
        }
    }
}

