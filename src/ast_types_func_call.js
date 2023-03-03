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
    ReadOnlyViolationError
} from './exceptions.js';

import {
    check_type,
    _fill_types
} from './ast_types.js';

import {
    find_id,
} from './ast_scopes.js';

import {
    copy_type,
    ensure_no_readonly_violation,
    ensure_type_is_one_of,
    coerce_func_call_args,
} from './ast_util.js';

import {
    optm_make_child,
    optm_move_node
} from './ast_optimize.js';


import Abi from './ast_abi.js';


export function _fill_types_func_call(node, node_type, scopes, opts) {
    _fill_types(node.name, 'expr', scopes, opts);
    if (!check_type(opts, node.name)) return;
    
    var func = node.name;  // an expression
        
    ensure_type_is_one_of(func, [
        { type:'func' },
        { type:'syscall_ref' }
    ], opts, `function`);

    var all_types_ok = true;
    node.args.forEach( arg => {
        _fill_types(arg, 'expr', scopes, opts);
        if (! check_type(opts, arg)) all_types_ok = false;
    });
    
    if (! all_types_ok) return;

    if (func.func_def && func.func_def.op == 'extern_func_def') {
        // external functions must be called indirectly through
        // contract-call. the function to call is the first argument
        // to contract-call.
        var args = node.args;
        delete node.args;
        args.unshift(optm_move_node(node.name, {}));
        Object.assign(node, {
            op: 'func_call',
            name: { op:'id', id:'contract-call?', type:null },
            args, 
            line: node.line
        });
        _fill_types(node.name, 'expr', scopes, opts);
        func = node.name;
    }
    else if (func.func_def) {
        // contact-call in ast_syscall will call this for the above case
        ensure_no_readonly_violation(func.func_def, scopes, node);
    }
        
    // func name expr may refer to a syscall or a func_def
    var def = func.func_def || func.syscall;

    // add bound args
    if (func.bind) node.args.unshift(...func.bind);    
    
    if (! def.abi) {
        // func_def
        // TODO: generically handle coercion for function calls and syscall arguments in Abi.validate_args(). allow for abi matching to succeed if arguments can be coerced.
        // this handles optional args, by making them optional
        // if the called function needs them
        coerce_func_call_args(def, node);
    }

    var abi = new Abi(def.name, def.abi || def);
    var abi_entry = abi.match_func_call(node, { unwrap_optional:true }); // throws
    if (def._fill_type) {
        try {
            def._fill_type(node, abi_entry, scopes, opts);
        } catch(e) {
            opts.handle_undetermined_error(e);
        }
    }
    else if (check_type(opts, def, `unresolved function '${def.name}'`)) {
        copy_type(def, node);
    }
}
