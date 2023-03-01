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
    InvalidLiteralValueError,
    NotSupportedError,
} from './exceptions.js';

import {
    optm_reset_node
} from './ast_optimize.js';

import {
    dump
} from './ast_util.js';


export function lookup_internal_call(id) {
    // _fill_type: set the return type of the syscall. called while
    //             walking the ast to fill in types. all func_call
    //             arguments will have valid types.

    const internal_calls = {
        '_utf8-to-ascii': {
            abi: {
                args: [{ type:'string' }],
                type: 'string-ascii',
            },
            name: '_utf8-to-ascii',
            desc: 'string object function ascii()',
            _fill_type: function(func_call, abi_entry) {

                if (func_call.args[0].op != 'lit') {
                    dump(func_call.args[0], true);
                    throw new NotSupportedError(func_call, `argument 1 must be a literal string`);
                }

                var good = true;
                var str = func_call.args[0].val;
                for (const codePoint of str) {
                    var cc = codePoint.codePointAt(0);
                    if (cc > 255) {
                        throw new InvalidLiteralValueError(func_call, `the string in argument 1 '${str}' is not ascii`);
                    }
                }
                    
                optm_reset_node(func_call, {
                    op:'lit',
                    type: 'string-ascii',
                    val: str
                });
            }
        },

    };

    return internal_calls[id];
}
