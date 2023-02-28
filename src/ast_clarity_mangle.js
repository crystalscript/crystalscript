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
    InternalError
} from './exceptions.js';

import {
    equal_types,
    copy_type,
    walk_cb,
    pretty_type,
} from './ast_util.js';

import {
    make_syscall
} from './ast_syscall.js';


// stacks-blockchain/clarity/src/vm/types/mod.rs
const MAX_VALUE_SIZE = 1024n * 1024n; // 1MB
const CHAR_SIZE = 4n;
const NUMBER_SIZE = 16n;
const BOOL_SIZE = 1n; // ??
const STX_ADDRESS_LENGTH = 41n;

function get_type_unit_size(type) {
    // approximation
    if (type.type == 'int' || type.type == 'uint') {
        return NUMBER_SIZE;
    }
    if (type.type == 'bool') {
        return BOOL_SIZE;
    }
    if (type.type == 'string') {
        return (type.size + 1n) * CHAR_SIZE;
    }
    if (type.type == 'principal') {
        if (type.subtype == 'keyword') {
            return (STX_ADDRESS_LENGTH + 1n) * CHAR_SIZE;
        }
        else {
            return (type.size + 1n) * CHAR_SIZE;
        }
    }
    if (type.type == 'list') {
        return type.size * get_max_list_size(type.itemtype);
    }
    if (type.type == 'map') {
        var size = 0n;
        for (var key in type.maptype) {
            size += BigInt(key.length + 2) * CHAR_SIZE;
            size += get_max_list_size(type.maptype[key]);
        }
        return size + 4n;
    }
    throw new InternalError(`unhandled type ${type.type}`);
}

function get_max_list_size(itemtype) {
    if (itemtype.type == '-') return 0;
    // approximation
    return MAX_VALUE_SIZE / get_type_unit_size(itemtype) - 100n; //8n;
}


export function mangle_foreach_anon(anon_func_def) {
    // fold only takes two arguments. to get around this to support
    // 'foreach' we stuff all closure vars, the optional index
    // argument, and a list to hold accumulated results into a map as
    // the second argument. an updated version of the map is returned
    // on each iteration.
    //
    // we create local variables for index and closure vars so they're
    // still accessible by id in the function body

    var list_size = anon_func_def.foreach_list_size ||
        get_max_list_size(anon_func_def);
    
    var arg1_maptype = {
        results: {
            type: 'list',
            itemtype: copy_type(anon_func_def, {}),
            size: list_size
        }
    };

    var fold_map_decl = {
        name: 'fold_map',
        protect: 'const',
        type: 'map',
        maptype: arg1_maptype
    };

    var has_index_arg = null;
    var has_closure_args = false;

    for (var idx=1; idx<anon_func_def.args.length; idx++) {
        var arg = anon_func_def.args[idx];

        var body_vardecl = {
            op: 'vardecl',
            id: arg.name,
            protect: 'const',
            type: copy_type(arg, {}),
            expr: {
                op: '[]',
                expr: {
                    op: 'id',
                    id: 'fold_map',
                    decl: fold_map_decl,
                    type: 'map',
                    maptype: arg1_maptype
                },
                bracket: {
                    op: 'lit',
                    type: 'string',
                    val: arg.name
                }
            }
        };
        
        if (idx==1 && !arg.closure) {
            has_index_arg = arg.name;
            arg1_maptype["index"] = arg;
            body_vardecl.expr.bracket.val = "index";
        }
        if (arg.closure) {
            if (!has_closure_args) {
                has_closure_args = true;
                arg1_maptype.closure_vars = {
                    type: 'map',
                    maptype: {}
                };
            }
            arg1_maptype.closure_vars.maptype[arg.name] = arg;
            body_vardecl.expr.bracket = {
                op: 'lit',
                type: 'string',
                val: 'closure_vars'
            };
            body_vardecl.expr = {
                op: '[]',
                expr: body_vardecl.expr,
                bracket: {
                    op: 'lit',
                    type: 'string',
                    val: arg.name
                }
            };
        }
            
        anon_func_def.body.unshift(body_vardecl);
    }
    
    anon_func_def.args.splice(1, Infinity);
    anon_func_def.args.push(fold_map_decl);
    

    // fold requires that the called function return the same type as
    // the second argument (args1_maptype). and it's very strict. the
    // returned map will be used as the second argument in the next
    // iteration.

    // all return statements must be changed to return 'return_map'
    // (with the return's old expr placed as indicated)
    function func_name_expr(name) {
        return {
            op:'id',
            id:name,
            syscall:lookup_syscall(name)
        };
    }

    function make_return_map(return_expr) {
        var return_map = {
            op:  'lit',
            type: 'map',
            maptype: arg1_maptype,
            val: {
                results: make_syscall(
                    'unwrap-panic', [
                        make_syscall('as-max-len?', [
                            make_syscall('append', [
                                {
                                    op: '[]',
                                    expr: {
                                        op: 'id',
                                        id: 'fold_map',
                                        decl: fold_map_decl,
                                        //type: 'map',
                                        //maptype: arg1_maptype
                                    },
                                    bracket: {
                                        op: 'lit',
                                        type: 'string',
                                        val: 'results'
                                    }
                                },
                                return_expr
                            ]),
                                
                            {
                                    op: 'lit',
                                type: 'uint',
                                val: arg1_maptype.results.size
                            }
                        ])
                    ]),
            }
                    
        };
    
    
        if (has_index_arg) {
            return_map.val["index"] = {
                op: '+',
                type: 'uint',
                multi:[{
                    op: 'id',
                    id: has_index_arg,
                    type: 'uint'
                }, {
                    op: 'lit',
                    type: 'uint',
                    val: 1n
                }]
            };
        }
        
        if (has_closure_args) {
            return_map.val['closure_vars'] = {
                op: '[]',
                expr: {
                    op: 'id',
                    id: 'fold_map',
                    decl: fold_map_decl,
                    //type: 'map',
                    //maptype: arg1_maptype
                },
                bracket: {
                    op: 'lit',
                    type: 'string',
                    val: 'closure_vars'
                }
            };
        }

        return return_map;
    }


    walk_cb(anon_func_def.body, node => {
        if (node.op == 'func_def' || node.op == 'anon_func_def') {
            return false;
        }
        else if (node.op == 'return') {
            node.expr = make_return_map(node.expr);
        }
    });

}
