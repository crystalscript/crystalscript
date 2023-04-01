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
    SyntaxError,
    TypeMismatchError,
    NotSupportedError,
    UndeterminedTypeError,
    ArgumentError,
    UndeclaredIdentifierError
} from './exceptions.js';

import {
    find_id,
} from './ast_scopes.js';    

import {
    is_undetermined_type,
    optional_of_any_type,
    trait_of_any_type,
    any_response,
    ok_response_of_any_type,
    err_response_of_any_type,
    copy_okerr_type,
    copy_type,
    equal_types,
    equal_types_strict,
    is_type_none,
    pretty_type,
    itemtype_of,
    ensure_no_readonly_violation,
    ensure_equal_types,
    unwrap_optional,
    coerce_lit_map_values,
} from './ast_util.js';

import {
    optm_reset_node
} from './ast_optimize.js';

import {
    MAX_VALUE_SIZE
} from './clarity_type_sizes.js';

import Abi from './ast_abi.js';


const abi_int_uint_2same = [
    { args:[{type:'int'}], type:'int' },
    { args:[{type:'uint'}], type:'uint' }
];

const abi_intX_uintX_2same = [
    { args:[{type:'int'},'...'],  type:'int' },
    { args:[{type:'uint'},'...'], type:'uint' }
];

const abi_intint_uintuint_2same = [
    { args:[{type:'int'},{type:'int'}],   type:'int' },
    { args:[{type:'uint'},{type:'uint'}], type:'uint' }
];

const abi_intuint_uintuint_2same = [
    { args:[{type:'int'},{type:'uint'}],  type:'int' },
    { args:[{type:'uint'},{type:'uint'}], type:'uint' }
];

const abi_intint_uintuint_2bool = [
    { args:[{type:'int'},{type:'int'}],   type:'bool' },
    { args:[{type:'uint'},{type:'uint'}], type:'bool' }
];

const abi_boolX_2bool = { args:[{type:'bool'},'...'], type:'bool' };

const operatorAbi = {
    '+':   abi_intX_uintX_2same,
    '-':   abi_intX_uintX_2same,
    '*':   abi_intX_uintX_2same,
    '/':   abi_intX_uintX_2same,
    '%':   abi_intint_uintuint_2same,
    '**':  abi_intint_uintuint_2same,
    '^':   abi_intX_uintX_2same,  // clarity1(xor), clarity2(bit-xor)
    '~':   abi_int_uint_2same,    // clarity2
    '&':   abi_intX_uintX_2same,  // clarity2
    '|':   abi_intX_uintX_2same,  // clarity2
    '<<':  abi_intuint_uintuint_2same,
    '>>':  abi_intuint_uintuint_2same,
    '>=':  abi_intint_uintuint_2bool,
    '<=':  abi_intint_uintuint_2bool,
    '>':   abi_intint_uintuint_2bool,
    '<':   abi_intint_uintuint_2bool,
    '==':  { args:[{type:'*'},'...'], type:'bool' },
    // '!=' - not a direct clarity function
    '&&':  abi_boolX_2bool,
    '||':  abi_boolX_2bool,
    '!':   { args:[{type:'bool'}], type:'bool' },
};

const abi_hashing_fn = [
    { args: [{ type: 'buff', size:'*' }], type: 'buff' },
    { args:[{ type:['uint','int'] }], type: 'buff' }
];




export function lookup_syscall(id, all) {
    // _fill_type: set the return type of the syscall. called while
    //             walking the ast to fill in types. all func_call
    //             arguments will have valid types.

    function _simple_copy_type(func_call, abi_entry) {
        copy_type(abi_entry, func_call);
    }

    const syscalls = {
        
        'err': {
            abi: {
                args: [
                    { type:'*' }
                ],
                type:'response',
                errtype:null
            },
            name: 'err',
            desc: 'constructs an error response',
            _fill_type: function(func_call, abi_entry, scopes, opts) {
                if (equal_types(func_call.args[0], any_response)) {
                    opts.compile.warning(func_call, `err() called on a value that is already a 'response' type`);
                }
                copy_type(abi_entry, func_call);
                func_call.errtype = copy_type(func_call.args[0], {});
            }
        },
        
        'ok': {
            abi: {
                args: [
                    { type:'*' }
                ],
                type:'response',
                oktype:null
            },
            name: 'ok',
            desc: 'constructs an ok response',
            _fill_type: function(func_call, abi_entry, scopes, opts) {
                if (equal_types(func_call.args[0], any_response)) {
                    opts.compile.warning(func_call, `ok() called on a value that is already a 'response' type`);
                }
                copy_type(abi_entry, func_call);
                func_call.oktype = copy_type(func_call.args[0], {});
            },
        },
        
        'sqrti': {
            abi: [
                {
                    args: [
                        { type:'int' }
                    ],
                    type:'int'
                },
                {
                    args: [
                        { type:'uint' }
                    ],
                    type:'uint'
                },
            ],
            name: 'sqrti',
            desc: 'integer square root',
            _fill_type: function(func_call, abi_entry) {
                copy_type(func_call.args[0], func_call);
            }
        },
        
        'log2': {
            abi: [
                {
                    args: [
                        { type:'int' }
                    ],
                    type:'int'
                },
                {
                    args: [
                        { type:'uint' }
                    ],
                    type:'uint'
                },
            ],
            name: 'log2',
            desc: 'base 2 logarithm',
            _fill_type: function(func_call, abi_entry) {
                copy_type(func_call.args[0], func_call);
            }
        },
        
        'map': {
            abi: {
                args: [
                    { type:['func','syscall_ref'] },
                    { type:'seq' },
                    "..."
                ],
                type:'list',
                itemtype:null
            },
            name: 'map',
            desc: 'construct a new list from the return values of a function that\'s called for every element of other lists',
            _fill_type: function(func_call, abi_entry) {                
                // the sequences do not need to be the same
                // size. clarityvm will use the smallest size
                
                // the function must accept the sequences' itemtype as
                // it's arguments
                
                var mapping_func_args  = [ ];
                for (var idx=1; idx<func_call.args.length; idx++) {
                    var itemtype = itemtype_of(func_call.args[idx]);
                    if (!itemtype) {
                        throw new UndeterminedTypeError(func_call, `the type of argument ${idx+1} is undetermined`);
                    }
                    mapping_func_args.push(itemtype);
                }

                var func_call_return_type = {
                    type:'list',
                    size: func_call.args[1].size,
                    itemtype: {}
                };

                if (func_call.args[0].type == 'func') {
                    var func_def = func_call.args[0].func_def;
                    var abi = new Abi(func_def.name, func_def);
                    if (func_def.uses_closure) {
                        throw new NotSupportedError(func_call, `mapping function '${func_call.args[0].id}' uses closure, which is not suppored`);
                    }
                    abi.validate_args(func_call, mapping_func_args);
                    if (is_undetermined_type(func_def)) {
                        throw new UndeterminedTypeError(func_call, `the return type of function '${func_def.name}' is undetermined`);
                    }
                    copy_type(func_def, func_call_return_type.itemtype);
                }
                else {
                    var syscall = func_call.args[0].syscall;
                    var abi = new Abi(syscall.name, syscall.abi);
                    var abi_entry = abi.validate_args(func_call, mapping_func_args);
                    copy_type(abi_entry, func_call_return_type.itemtype);
                }
                copy_type(func_call_return_type, func_call);
            }
        },

        'fold': {
            abi: {
                args: [
                    {type: ['func','syscall_ref'] },
                    { type: 'seq' },
                    { type: '*' }
                ],
                type: '*'
            },
            name: 'fold',
            desc: 'obtain a value from a list where a function is called for each element of the list with the element plus the prior result',
            _fill_type: function(func_call, abi_entry) {
                // the function(arg0) must accept 2 arguments:
                //   1. has a type of seq(arg1)'s itemtype
                //   2. has a type of initial-value(arg2) type
                if (! equal_types(itemtype_of(func_call.args[1]),
                                  optional_of_any_type)) {
                    unwrap_optional(func_call.args[2]);
                }

                var folding_func_args  = [
                    itemtype_of(func_call.args[1]),
                    func_call.args[2]
                ];

                // the function(arg0) must return a type the same as
                // initial-value(arg2)

                // fold returns the same type as function(arg0)

                // validate folding func args
                if (func_call.args[0].type == 'func') {
                    var func_def = func_call.args[0].func_def;
                    if (func_def.uses_closure) {
                        throw new NotSupportedError(func_call, `folding function '${func_call.args[0].id}' uses closure, which is not suppored`);
                    }
                    var abi = new Abi(func_def.name, func_def);
                    abi.validate_args(func_call, folding_func_args);
                    if (is_undetermined_type(func_def)) {
                        throw new UndeterminedTypeError(func_call, `the return type of function '${func_def.name}' is undetermined`);
                    }
                    if (! equal_types(func_def, func_call.args[2])) {
                        throw new TypeMismatchError(func_call, `the function '${func_def.name}' in argument 1 returns '${pretty_type(func_def)}' but must return the same type as argument 3 ('${pretty_type(func_call.args[2])}')`);
                    }
                    copy_type(func_def, func_call);
                }
                else {
                    var syscall = func_call.args[0].syscall;
                    var abi = new Abi(syscall.name, syscall.abi);
                    var abi_entry = abi.validate_args(func_call, folding_func_args);
                    if (! equal_types(abi_entry, func_call.args[2])) {
                        throw new TypeMismatchError(func_call, `the function '${syscall.name}' in argument 1 returns '${pretty_type(abi_entry)}' but must return the same type as argument 3 ('${pretty_type(func_call.args[2])}')`);
                    }
                    copy_type(abi_entry, func_call);
                }
            }
        },

        'filter': {
            abi:{
                args: [
                    {type: ['func','syscall_ref'] }, // function to call
                    { type: 'seq' },  // items to iterate
                ],
                type: 'seq'
            },
            name: 'filter',
            desc: 'calls a function for each element of a list and returns a new list containing elements for which the function returned true',
            _fill_type: function(func_call, abi_entry) {
                // the function must accept arg1's itemtype as it's argument
                var filter_func_args  = [
                    itemtype_of(func_call.args[1]),
                ];

                if (func_call.args[0].type == 'func') {
                    var func_def = func_call.args[0].func_def;
                    if (func_def.uses_closure) {
                        throw new NotSupportedError(func_call, `filter function '${func_call.args[0].id}' uses closure, which is not suppored`);
                    }
                    var abi = new Abi(func_def.name, func_def);
                    abi.validate_args(func_call, filter_func_args);
                    if (is_undetermined_type(func_def)) {
                        throw new UndeterminedTypeError(func_call, `the return type of function '${func_def.name}' is undetermined`);
                    }
                    // the function must return a bool
                    if (!equal_types(func_def, { type:'bool' }))
                        throw new TypeMismatchError(func_call, `the 'filter' function '${func_def.name}' returns '${pretty_type(func_def)}, but is required to return 'bool'`);
                }
                else {
                    var syscall = func_call.args[0].syscall;
                    var abi = new Abi(syscall.name, syscall.abi);
                    var abi_entry = abi.validate_args(func_call, filter_func_args);
                    if (!equal_types(abi_entry, { type:'bool' }))
                        throw new TypeMismatchError(func_call, `the 'filter' function '${syscall.name}' returns '${pretty_type(abi_entry)}, but is required to return 'bool'`);
                }
                copy_type(func_call.args[1], func_call);
            }
        },

        'append': {
            abi: {
                args:[
                    { type:'list', itemtype:{type:'*'} },
                    { type:'*' }
                ],
                type: 'list',
                itemtype: '*'
            },
            name: 'append',
            desc: 'append a single element to a list and returns the new list',
            _fill_type: function(func_call, abi_entry) {
                // arg1 is appended to the list (arg0)
                // arg1's type must be the same as arg0's itemtype
                if (! equal_types(func_call.args[0].itemtype,
                                  optional_of_any_type))
                {
                    unwrap_optional(func_call.args[1]);
                }
                ensure_equal_types(
                    func_call.args[0].itemtype,
                    func_call.args[1],
                    { ctx_node: func_call },
                    'append item and list elements have different types'
                );
                copy_type(func_call.args[0], func_call);
                func_call.size += 1n;
            }
        },

        'concat': {
            abi: {
                args:[
                    { type:'seq' },
                    { type:'seq' }
                ],
                type: 'seq'
            },
            name: 'concat',
            desc: 'concatenates two sequences and returns the new sequence',
            _fill_type: function(func_call, abi_entry) {
                // arg1 is appended to the list (arg1)
                // arg1's itemtype must be the same as arg0's itemtype
                ensure_equal_types(
                    itemtype_of(func_call.args[0]),
                    itemtype_of(func_call.args[1]),
                    { ctx_node: func_call },
                    'both sequences must have the same element type'
                );
                copy_type(func_call.args[0], func_call);
                func_call.size =
                    func_call.args[0].size +
                    func_call.args[1].size;
            }
        },

        'as-max-len?': {
            abi: {
                args: [
                    { type:'seq' },
                    { type:'uint' }
                ],
                type: 'optional',
                itemtype: {
                    type: 'seq'
                }
            },
            name: 'as-max-len?',
            desc: 'changes the maximum size of a sequence',
            _fill_type: function(func_call, abi_entry) {
                if (func_call.args[1].op != 'lit') {
                    // just, like, why?
                    throw new SyntaxError(func_call, `clarity's ${this.name} only accepts a literal length argument, expressions are not allowed`);
                }
                copy_type(
                    { type:'optional', itemtype:func_call.args[0] },
                    func_call,
                    null,
                    "deep"
                );
                func_call.itemtype.size = func_call.args[1].val;
            }
        },

        'len': {
            abi: {
                args: [
                    { type: 'seq' }
                ],
                type: 'uint'
            },
            name: 'len',
            desc: 'obtain the length of a sequence',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'index-of?': {
            abi: {
                args: [
                    { type: 'seq' }, // sequence to search
                    { type: '*' }    // item to find
                ],
                type: 'optional',
                itemtype: {
                    type: 'uint'
                }
            },
            name: 'index-of?',
            desc: 'find an element and return it\'s index within a sequence',
            _fill_type: function(func_call, abi_entry) {
                if (equal_types(func_call.args[1], { type:'map' }) &&
                    equal_types(itemtype_of(func_call.args[0]), { type:'map' }))
                {
                    coerce_lit_map_values(func_call.args[0].itemtype,
                                          func_call.args[1]);
                }
                else if (! equal_types(itemtype_of(func_call.args[0]),
                                       optional_of_any_type)) {
                    unwrap_optional(func_call.args[1]);
                }

                // arg1's type must match arg0's itemtype, strictly
                if (! equal_types_strict( itemtype_of(func_call.args[0]),
                                          func_call.args[1]))
                {
                    throw new TypeMismatchError(func_call, `the sequence's element type '${pretty_type(itemtype_of(func_call.args[0]))}' does not match the item to find '${pretty_type(func_call.args[1])}'`);
                }

                copy_type(abi_entry, func_call);
            }
        },

        'merge': {
            abi: {
                args: [
                    { type: 'map', maptype:'*' },
                    { type: 'map', maptype:'*' }
                ],
                type: 'map',
                maptype: null
            },
            name: 'merge',
            desc: 'combine two maps into a new map',
            _fill_type: function(func_call, abi_entry) {
                // individual key values can be optional types, or vise versa
                // keep the optional type of arg0, and change arg1
                // => because the returned map's types are modified it's
                //    probably not a good idea to coerce optionals since
                //    it may produce different types when not using a lit
                // coerce_lit_map_values(func_call.args[0],
                //                       func_call.args[1]);
                
                copy_type(func_call.args[0], func_call, null, "deep");
                
                // if keys overwrite, they don't need to be the same type
                for (var key in func_call.args[1].maptype) {
                    func_call.maptype[key] =
                        copy_type(func_call.args[1].maptype[key], {}, null, "deep");
                }
            }
        },

        'hash160': {
            abi: abi_hashing_fn,
            name: 'hash160',
            desc: 'compute hash',
            _fill_type: function(func_call, abi_entry) {
                copy_type(
                    { type:'buff', size:20n },
                    func_call
                );
            }
        },

        'sha256': {
            abi: abi_hashing_fn,
            name: 'sha256',
            desc: 'compute hash',
            _fill_type: function(func_call, abi_entry) {
                copy_type(
                    { type:'buff', size:32n },
                    func_call
                );
            }
        },

        'sha512': {
            abi: abi_hashing_fn,
            name: 'sha512',
            desc: 'compute hash',
            _fill_type: function(func_call, abi_entry) {
                copy_type(
                    { type:'buff', size:64n },
                    func_call
                );
            }
        },

        'sha512-256': {
            abi: abi_hashing_fn,
            name: 'sha512-256',
            desc: 'compute hash',
            _fill_type: function(func_call, abi_entry) {
                copy_type(
                    { type:'buff', size:32n },
                    func_call
                );
            }
        },

        'keccak256': {
            abi: abi_hashing_fn,
            name: 'keccak256',
            desc: 'compute hash',
            _fill_type: function(func_call, abi_entry) {
                copy_type(
                    { type:'buff', size:32n },
                    func_call
                );
            }
        },

        'secp256k1-recover?': {
            abi: [
                {
                    args: [{ type:'buff', size:32n }],
                    type: 'response',
                    oktype: { type:'buff', size:33n },
                    errtype: { type:'uint' }
                },
                {
                    args: [{ type:'buff', size:65n }],
                    type: 'response',
                    oktype: { type:'buff', size:33n },
                    errtype: { type:'uint' }
                }
            ],
            name: 'secp256k1-recover?',
            desc: 'obtain the public key used to sign a message',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'secp256k1-verify': {
            abi: [{
                args: [
                    { type:'buff', size:32n },
                    { type:'buff', size:64n },
                    { type:'buff', size:33n }
                ],
                type: 'bool'
            }, {
                args: [
                    { type:'buff', size:32n },
                    { type:'buff', size:65n },
                    { type:'buff', size:33n }
                ],
                type: 'bool'
            }],
            name: 'secp256k1-verify',
            desc: 'verify a signature',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'print': {
            abi: {
                args: [{ type:'*' }],
                type: '*'
            },
            name: 'print',
            desc: 'output event',
            _fill_type: function(func_call, abi_entry) {
                // print returns the type of its argument
                copy_type(func_call.args[0], func_call);
            }
        },
        
        'contract-call?': {
            abi: [
                {
                    args: [
                        {type:'func'}, // contract.function
                        '...', // zero or more arguments of any type
                        {type:'*'}
                    ],
                    type: 'response',
                },
            ],
            name: 'contract-call?',
            desc: 'call pubic or readonly functions of other contracts',
            _fill_type: function(func_call, abi_entry, scopes, opts) {
                var func = func_call.args[0];
                var func_def = func.func_def;
                var func_impl = func.func_impl;
                if (! func_def || func_def.op != 'extern_func_def') {
                    throw new ArgumentError(func_call, `only calls to other contracts may be made with contract-call`);
                }

                ensure_no_readonly_violation(func_def, scopes, func_call);

                // ensure the function is suitable for the arguments given
                var abi = new Abi(func_def.name, func_def);
                abi.validate_args(func_call, func_call.args.slice(1),
                                  { unwrap_optional: true });

                // modify the ast for c2c (contract-call? uses two
                // args to identify the function)
                var newargs = [
                    func_impl || 
                        {
                            op:'lit',
                            type:'principal',
                            val: func_def.contract_id.val
                        },
                    {
                        op:'lit',
                        type:'string',
                        subtype:'keyword',
                        val: func_def.name
                    }
                ];
                func_call.args.splice(0, 1, ...newargs);
                copy_type(func_def, func_call);
            }
        },


        'as-contract': {
            abi: {
                args: [{ type:'*' }],
                type: '*'
            },
            name: 'as-contract',
            desc: 'execute an expression as the contract instead of the caller',
            _fill_type: function(func_call, abi_entry) {
                // as-contract returns the type of its argument
                copy_type(func_call.args[0], func_call);
            }
        },

        'contract-of': {
            abi: {
                args: [ trait_of_any_type ],
                type: 'principal'
            },
            name: 'contract-of',
            desc: 'get the principal implementing a trait',
            _fill_type: function(func_call, abi_entry) {
                // returns the principal of the contract implemeting the trait
                if (! func_call.args[0].decl || func_call.args[0].decl.access != 'trait') {
                    throw new TypeMismatchError(func_call, `the argument to 'contract-of' must be the name of a trait (from 'use-trait')`);
                }
                copy_type(abi_entry, func_call);
            }
        },

        'principal-of?': {
            abi: {
                args: [{ type:'buff', size:33n }],
                type: 'response',
                oktype: { type:'principal' },
                errtype: { type:'uint' }
            },
            name: 'principal-of?',
            desc: 'get the principal from a public key',
            _fill_type: function(func_call, abi_entry) {
                // returns the principal derived from the public key or u1
                copy_type(abi_entry, func_call);
            }
        },            

        'at-block': {
            abi: {
                args: [
                    { type:'buff', size:32n },
                    { type:'*' }
                ],
                type: '*'
            },
            name: 'at-block',
            desc: '',
            _fill_type: function(func_call, abi_entry) {
                copy_type(func_call.args[0], func_call);
            }
        },            

        'get-block-info?': {
            abi: {
                args: [
                    { type:['string', 'string-ascii'] },
                    { type:'uint' }
                ],
                type: 'optional',
                itemtype: { type:'*' }
            },
            name: 'get-block-info?',
            desc: '',
            _fill_type: function(func_call, abi_entry) {
                if (func_call.args[0].op != 'lit') {
                    throw new SyntaxError(func_call, `the first argument to 'get-block-info?' must be a literal string`);
                }
                // set the property name to a keyword to avoid quoting
                // when converted to clarity
                func_call.args[0].subtype = 'keyword';
                const valid_properties = {
                    'time': { type:'uint' },
                    'header-hash': { type:'buff', size:32n },
                    'burnchain-header-hash': { type:'buff', size:32n },
                    'id-header-hash': { type:'buff', size:32n },
                    'miner-address': { type:'principal' },
                    'vrf-seed': { type:'buff', size:32n },
                    'block-reward': { type:'uint' },      // clarity 2
                    'miner-spend-total': { type:'uint' }, // clarity 2
                    'miner-spend-winner': { type:'uint' } // clarity 2
                };
                var itemtype = valid_properties[func_call.args[0].val];
                if (! itemtype) {
                    throw new SyntaxError(func_call, `'${func_call.args[0].val}' is not a valid property name. Available property names are: ${Object.keys(valid_properties).join(', ')}`);
                }
                copy_type({ type:'optional', itemtype}, func_call);
            }
        },

        'get-burn-block-info?': {
            abi: {
                args: [
                    { type:['string', 'string-ascii'] },
                    { type:'uint' }
                ],
                type: 'optional',
                itemtype: { type:'*' }
            },
            name: 'get-burn-block-info?',
            clarver: 2,
            desc: '',
            _fill_type: function(func_call, abi_entry) {
                if (func_call.args[0].op != 'lit') {
                    throw new SyntaxError(func_call, `the first argument to 'get-burn-block-info?' must be a literal string`);
                }
                // set the property name to a keyword to avoid quoting
                // when converted to clarity
                func_call.args[0].subtype = 'keyword';
                const valid_properties = {
                    'header-hash': { type:'buff', size:32n },
                    'pox-addrs': { type:'map', maptype: {
                        addrs: { type:'list', size:2n, itemtype:{
                            type:'map', maptype:{
                                hashbytes: { type:'buff', size:32n },
                                version: { type:'buff', size:1n }
                            }}},
                        payout: { type:'uint' }
                    }},
                };
                var itemtype = valid_properties[func_call.args[0].val];
                if (! itemtype) {
                    throw new SyntaxError(func_call, `'${func_call.args[0].val}' is not a valid property name. Available property names are: ${Object.keys(valid_properties).join(', ')}`);
                }
                copy_type({ type:'optional', itemtype}, func_call);
            }
        },

        'default-to': {
            abi: {
                args: [
                    { type:'+' },    // default value
                    optional_of_any_type,  // optional or response
                ],
                type: '+'
            },
            name: 'default-to',
            desc: 'returns the given value unless it\'s none, in which case the supplied "default value" is returned instead',
            _fill_type: function(func_call, abi_entry) {
                // arg0 and arg1's itemtype must be the same type
                var arg0 = func_call.args[0];
                var arg1 = func_call.args[1];
                if (is_type_none(arg1)) {
                    copy_type(arg0, func_call);
                }
                else if (!equal_types(arg0, arg1.itemtype)) {
                    throw new TypeMismatchError(`the default value type '${pretty_type(arg0)}' does not match the option value type '${pretty_type(arg1.itemtype)}'`);
                }
                else {                
                    copy_type(arg1.itemtype, func_call);
                }
            }
        },

        'asserts!': {
            abi: {
                args: [
                    { type:'bool' },  // test-expr
                    { type:'*' }      // thrown value
                ],
                type: 'bool'
            },
            name: 'asserts!',
            desc: 'assert that an expression is true, or return from the function',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            },
            _thrown_type: function(func_call) {
                return func_call.args[1];
            }
        },

        'unwrap!': {
            abi: [{
                args: [
                    optional_of_any_type,  // optional to unwrap
                    { type:'*' }    // thrown value
                ],
                type: '*'
            }, {
                args: [
                    any_response,
                    { type:'*' }
                ],
                type: '*'
                
            }],
            name: 'unwrap!',
            desc: 'return from the function if the response is err, or the optional\'s value is none, otherwise returns the value',
            _fill_type: function(func_call, abi_entry) {
                if (abi_entry.args[0].type == 'optional') {
                    copy_type(func_call.args[0].itemtype, func_call);
                }
                else if (equal_types(func_call.args[0], ok_response_of_any_type)) {
                    copy_okerr_type(func_call.args[0].oktype, func_call);
                }
                else {
                    // undetermined type
                    throw new UndeterminedTypeError(func_call, `the type of the first argument to unwrap is undetermined because there is no ok type associated with the response type '${pretty_type(func_call.args[0])}'`);
                }
            },
            _thrown_type: function(func_call) {
                return func_call.args[1];
            }
        },

        'unwrap-err!': {
            abi:{
                args: [ any_response, { type:'*' } ],
                type: '*'
            },
            name: 'unwrap-err!',
            desc: 'return from the function if the response is ok, otherwise returns the value',
            _fill_type: function(func_call, abi_entry) {
                if (equal_types(func_call.args[0], err_response_of_any_type)) {
                    copy_okerr_type(func_call.args[0].errtype, func_call);
                }
                else {
                    // undetermined type
                    throw new UndeterminedTypeError(func_call, `the type of the first argument to unwrap-err is undetermined because there is no err type associated with the response type '${pretty_type(func_call.args[0])}'`);
                }
            },
            _thrown_type: function(func_call) {
                return func_call.args[1];
            }
        },
        
        'unwrap-panic': {
            abi: [{
                args: [ optional_of_any_type ],
                type: '*'
            }, {
                args: [ any_response ],
                type: '*'
            }],
            name: 'unwrap-panic',
            desc: 'return from the function if the response is err or the optional is none, otherwise return the value',
            _fill_type: function(func_call, abi_entry) {
                if (abi_entry.args[0].type == 'optional') {
                    copy_type(func_call.args[0].itemtype, func_call);
                }
                else if (equal_types(func_call.args[0], ok_response_of_any_type)) {
                    copy_okerr_type(func_call.args[0].oktype, func_call);
                }
                else {
                    // undetermined type
                    throw new UndeterminedTypeError(func_call, `the type of the first argument to unwrap-panic is undetermined because there is no ok type associated with the response type '${pretty_type(func_call.args[0])}'`);
                }
            }
        },
        
        'unwrap-err-panic': {
            abi:{
                args: [ any_response ],
                type: '*'
            },
            name: 'unwrap-err-panic',
            desc: 'return from the function if the response is ok, otherwise return the value',
            _fill_type: function(func_call, abi_entry) {
                if (equal_types(func_call.args[0], err_response_of_any_type)) {
                    copy_okerr_type(func_call.args[0].errtype, func_call);
                }
                else {
                    // undetermined type
                    throw new UndeterminedTypeError(func_call, `the type of the first argument to unwrap-err-panic is undetermined because there is no err type associated with the response type '${pretty_type(func_call.args[0])}'`);
                }
            }
        },
        
        'try!': {
            abi: [{
                args: [ optional_of_any_type ],
                type: '*'
            }, {
                args: [ any_response ],
                type: '*'
            }],
            name: 'try!',
            desc: 'return from the function if the response is err or the optional is none, otherwise returns the value',
            _fill_type: function(func_call, abi_entry) {
                if (abi_entry.args[0].type == 'optional') {
                    copy_type(func_call.args[0].itemtype, func_call);
                }
                else if (equal_types(func_call.args[0], ok_response_of_any_type)) {
                    copy_okerr_type(func_call.args[0].oktype, func_call);
                }
                else {
                    // undetermined type
                    throw new UndeterminedTypeError(func_call, `the type of the first argument to try! is undetermined because there is no ok type associated with the response type '${pretty_type(func_call.args[0])}'`);
                }
            },
            _thrown_type: function(func_call) {
                return func_call.args[0];
            }
        },

        'is-ok': {
            abi: {
                args: [ any_response ],
                type: 'bool'
            },
            name: 'is-ok',
            desc: 'test whether a response is ok',
            _fill_type: function(func_call, abi_entry) {
                if (equal_types(func_call.args[0], ok_response_of_any_type)) {
                    copy_type(abi_entry, func_call);
                }
                else {
                    // the response has no oktype. clarity returns an
                    // error for these, but we can avoid the problem
                    // with this optimization
                    optm_reset_node(func_call,
                                    { op:'lit', type:'bool', val:false });
                }
            }
        },

        'is-err': {
            abi: {
                args: [ any_response ],
                type: 'bool'
            },
            name: 'is-err',
            desc: 'test whether a response is an err',
            _fill_type: function(func_call, abi_entry) {
                if (equal_types(func_call.args[0], err_response_of_any_type)) {
                    copy_type(abi_entry, func_call);
                }
                else {
                    // the response has no errtype. clarity returns an
                    // error for these, but we can avoid the problem
                    // with this optimization
                    optm_reset_node(func_call,
                                    { op:'lit', type:'bool', val:false });
                }
            }
        },

        'is-none': {
            abi: {
                args: [ optional_of_any_type ],
                type: 'bool'
            },
            name: 'is-none',
            desc: 'test whether an optional is none',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'is-some': {
            abi: {
                args: [ optional_of_any_type ],
                type: 'bool'
            },
            name: 'is-some',
            desc: 'test whether an optional is not none',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'ft-get-balance': {
            abi: {
                args: [
                    { type:'ft' },
                    { type:'principal' }
                ],
                type: 'uint'
            },
            name: 'ft-get-balance',
            desc: 'fungible token balance of a principal',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },
        
        'ft-get-supply': {
            abi: {
                args: [
                    { type:'ft' },
                ],
                type: 'uint'
            },
            name: 'ft-get-supply',
            desc: 'fungible token supply outstanding',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'ft-transfer?': {
            abi: {
                args: [
                    { type:'ft' },        // token-name
                    { type:'uint' },      // amt
                    { type:'principal' }, // sender
                    { type:'principal' }  // recipient
                ],
                type: 'response',
                oktype: { type: 'bool' },
                errtype: { type: 'uint' }
            },
            name: 'ft-transfer?',
            desc: 'move fungible tokens between parties',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'ft-mint?': {
            abi: {
                args: [
                    { type:'ft' },        // token-name
                    { type:'uint' },      // amt
                    { type:'principal' }, // recipient
                ],
                type: 'response',
                oktype: { type: 'bool' },
                errtype: { type: 'uint' }
            },
            name: 'ft-mint?',
            desc: 'mint fungible tokens and increase outstanding supply',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'ft-burn?': {
            abi: {
                args: [
                    { type:'ft' },        // token-name
                    { type:'uint' },      // amt
                    { type:'principal' }, // sender
                ],
                type: 'response',
                oktype: { type: 'bool' },
                errtype: { type: 'uint' }
            },
            name: 'ft-burn?',
            desc: 'remove tokens from the outstanding supply',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },
        
        'nft-get-owner?': {
            abi: {
                args: [
                    { type:'nft' }, // asset-class (nft name)
                    { type:'+' }, // asset-id
                ], 
                type: 'optional',
                itemtype: { type:'principal' }
            },       
            name: 'nft-get-owner?',
            desc: 'obtain the owner of an nft',
            _fill_type: function(func_call, abi_entry) {
                ensure_equal_types(
                    func_call.args[0].decl.tokenidtype,
                    func_call.args[1],
                    { ctx_node: func_call },
                    `nft asset id`
                );
                copy_type(abi_entry, func_call);
            }
        },

        'nft-transfer?': {
            abi: {
                args: [
                    { type:'nft' }, // asset-class (nft name)
                    { type:'+' }, // asset-id
                    { type:'principal' }, // sender
                    { type:'principal' }  // recipient
                ], 
                type: 'response',
                oktype: { type:'bool' },
                errtype: { type:'uint' }
            },       
            name: 'nft-transfer?',
            desc: 'transfer an nft between parties',
            _fill_type: function(func_call, abi_entry) {
                ensure_equal_types(
                    func_call.args[0].decl.tokenidtype,
                    func_call.args[1],
                    { ctx_node: func_call },
                    `nft asset id`
                );
                copy_type(abi_entry, func_call);
            }
        },

        'nft-mint?': {
            abi: {
                args: [
                    { type:'nft' }, // asset-class (nft name)
                    { type:'+' }, // asset-id
                    { type:'principal' }  // recipient
                ], 
                type: 'response',
                oktype: { type:'bool' },
                errtype: { type:'uint' }
            },       
            name: 'nft-mint?',
            desc: 'create an nft',
            _fill_type: function(func_call, abi_entry) {
                ensure_equal_types(
                    func_call.args[0].decl.tokenidtype,
                    func_call.args[1],
                    { ctx_node: func_call },
                    `nft asset id`
                );
                copy_type(abi_entry, func_call);
            }
        },

        'nft-burn?': {
            abi: {
                args: [
                    { type:'nft' }, // asset-class (nft name)
                    { type:'+' }, // asset-id
                    { type:'principal' }  // recipient
                ], 
                type: 'response',
                oktype: { type:'bool' },
                errtype: { type:'uint' }
            },       
            name: 'nft-burn?',
            desc: 'destroy an nft',
            _fill_type: function(func_call, abi_entry) {
                ensure_equal_types(
                    func_call.args[0].decl.tokenidtype,
                    func_call.args[1],
                    { ctx_node: func_call },
                    `nft asset id`
                );
                copy_type(abi_entry, func_call);
            }
        },

        'stx-account': {
            abi: {
                args: [{ type: 'principal' }],
                type: 'map',
                maptype: {
                    locked: { type:'uint' },
                    "unlock-height": { type:'uint' },
                    unlocked: { type:'uint' }
                }
            },
            name:'stx-account',
            clarver: 2,
            desc:'',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }            
        },
        
        'stx-get-balance': {
            abi:{
                args: [ {type:'principal'} ],
                type: 'uint'
            },
            name: 'stx-get-balance',
            desc: 'returns the principal\'s stx balance',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'stx-transfer?': {
            abi:{
                args: [
                    { type:'uint' },  // amount
                    { type:'principal' }, // sender (must be "current context's" tx-sender)
                    { type:'principal' }, // recipient
                ],
                type: 'response',
                oktype: 'bool',
                errtype: 'uint'
            },
            name: 'stx-transfer?',
            desc: 'transfer stx between two parties',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'stx-transfer-memo?': {
            abi:{
                args: [
                    { type:'uint' },  // amount
                    { type:'principal' }, // sender (must be "current context's" tx-sender)
                    { type:'principal' }, // recipient
                    { type:'buff', size:'*' },  // memo
                ],
                type: 'response',
                oktype: 'bool',
                errtype: 'uint'
            },
            name: 'stx-transfer-memo?',
            clarver: 2,
            desc: 'transfer stx between two parties, with a memo',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'stx-burn?': {
            abi:{
                args: [
                    { type:'uint' },  // amount
                    { type:'principal' }, // sender (must be "current context's" tx-sender)
                ],
                type: 'response',
                oktype: 'bool',
                errtype: 'uint'
            },
            name: 'stx-burn?',
            desc: 'destroy stx',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'buff-to-int-be': {
            abi: {
                args: [{ type:'buff', size:16n }],
                type: 'int'
            },
            name: 'buff-to-int-be',
            clarver: 2,
            desc: 'convert a buff in big-endian to an integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }            
        },

        'buff-to-int-le': {
            abi: {
                args: [{ type:'buff', size:16n }],
                type: 'int'
            },
            name: 'buff-to-int-le',
            clarver: 2,
            desc: 'convert a buff in little-endian to an integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }            
        },

        'buff-to-uint-be': {
            abi: {
                args: [{ type:'buff', size:16n }],
                type: 'int'
            },
            name: 'buff-to-uint-be',
            clarver: 2,
            desc: 'convert a buff in big-endian to an unsigned integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }            
        },

        'buff-to-uint-le': {
            abi: {
                args: [{ type:'buff', size:16n }],
                type: 'int'
            },
            name: 'buff-to-uint-le',
            clarver: 2,
            desc: 'convert a buff in little-endian to an unsigned integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'to-consensus-buff?': {
            abi: {
                args: [{ type:'*' }], // type:* not '+'
                type: 'optional',
                itemtype: {
                    type: 'buff',
                    size: MAX_VALUE_SIZE - 8n // (approx!) subtract serialized type prefix
                }
            },
            name: 'to-consensus-buff?',
            clarver: 2,
            desc: 'serialize any value into a buffer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }            
        },
        
        'from-consensus-buff?': {
            abi: {
                args: [
                    { type:'typedef' },
                    { type:'buff', size:'*' }
                ],
                type: 'optional',
                itemtype: '*'
            },
            name: 'from-consensus-buff?',
            clarver: 2,
            desc: 'deserialize a buffer into a Clarity value',
            _fill_type: function(func_call, abi_entry) {
                // the deserialization returns the type specified
                // by argument 0, or none if it fails
                copy_type({
                    type:'optional',
                    itemtype:func_call.args[0].typedef
                }, func_call);
            }
        },

        'int-to-ascii': {
            abi: {
                args: [{ type:['int','uint'] }],
                type: 'string-ascii',
                size: 40n
            },
            name:'int-to-ascii',
            clarver: 2,
            desc: 'convert number to string-ascii form',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'int-to-utf8': {
            abi: {
                args: [{ type:['int','uint'] }],
                type: 'string',
                size: 40n
            },
            name:'int-to-utf8',
            clarver: 2,
            desc: 'convert number to string form',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },
        
        'string-to-int?': {
            abi: [
                {
                    args: [{ type:'string-ascii', size:1048576n }],
                    type: 'optional',
                    itemtype: { type:'int' }
                },
                {
                    args: [{ type:'string', size:262144n }],
                    type: 'optional',
                    itemtype: { type:'int' }
                }
            ],
            name:'string-to-int?',
            clarver: 2,
            desc: 'convert a string to integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'string-to-uint?': {
            abi: [
                {
                    args: [{ type:'string-ascii', size:1048576n }],
                    type: 'optional',
                    itemtype: { type:'uint' }
                },
                {
                    args: [{ type:'string', size:262144n }],
                    type: 'optional',
                    itemtype: { type:'uint' }
                }
            ],
            name:'string-to-uint?',
            clarver: 2,
            desc: 'convert a string to an unsigned integer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'is-standard': {
            abi: {
                args: [{ type:'principal' }],
                type: 'bool'
            },
            name:'is-standard',
            clarver: 2,
            desc: 'tests whether the principal matches the current network type',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'principal-construct?': {
            abi:[
                {
                    args: [
                        { type:'buff', size:1n },
                        { type:'buff', size:20n }
                    ],
                    type:'response',
                    oktype: { type:'principal' },
                    errtype: { type:'map', maptype:{
                        error_code: {
                            type:'uint'
                        },
                        value: {
                            type:'optional',
                            itemtype: { type:'principal' }
                        }
                    }}
                },
                
                {
                    args: [
                        { type:'buff', size:1n },
                        { type:'buff', size:20n },
                        { type:'string-ascii', size:40n }
                    ],
                    type:'response',
                    oktype: { type:'principal' },
                    errtype: { type:'map', maptype:{
                        error_code: {
                            type:'uint'
                        },
                        value: {
                            type:'optional',
                            itemtype: { type:'principal' }
                        }
                    }}
                },
            ],
            name:'principal-construct?',
            clarver: 2,
            desc: 'get a principal from a buffer',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'principal-destruct?': {
            abi: {
                args: [{ type:'principal' }],
                type: 'response',
                oktype: { type:'map', maptype:{
                    "hash-bytes": { type:'buff', size:20n },
                    name: {
                        type:'optional',
                        itemtype:{ type:'string-ascii', size:40n }
                    },
                    version: { type:'buff', size:1n }
                }},
                errtype: { type:'map', maptype:{   // same as oktype
                    "hash-bytes": { type:'buff', size:20n },
                    name: {
                        type:'optional',
                        itemtype:{ type:'string-ascii', size:40n }
                    },
                    version: { type:'buff', size:1n }
                }}
            },
            name:'principal-destruct?',
            clarver: 2,
            desc: 'convert principal into details about the principal',
            _fill_type: function(func_call, abi_entry) {
                copy_type(abi_entry, func_call);
            }
        },

        'replace-at?': {
            abi: {
                args: [
                    { type:'seq' },
                    { type:'uint' },   // index to replace
                    { type:'*' }       // new value, incl. optional
                ],
                type: 'optional',   // 'none' if index out of range
                itemtype: '*'       // list of the same type as arg0
            },
            name: 'replace-at?',
            clarver: 2,
            desc: 'returns a new list with the element at the selected index replaced with the new value',
            _fill_type: function(func_call, abi_entry) {
                // returns a list of same type, except optional
                copy_type({
                    type:'optional',
                    itemtype:func_call.args[0]
                }, func_call);
            }
        },

        'slice?': {
            abi: {
                args: [
                    { type:'seq' },
                    { type:'uint' }, // left index
                    { type:'uint' }  // right index (non-inclusive)
                ],
                type: 'optional',
                itemtype:'*'
            },
            name: 'slice?',
            clarver: 2,
            desc: 'get a portion of a sequence',
            _fill_type: function(func_call, abi_entry) {
                // returns a list of same type, except optional
                copy_type({
                    type:'optional',
                    itemtype:func_call.args[0]
                }, func_call);
            }
        },
        
    };

    
    if (operatorAbi[id]) {
        // operators may be passed as a function argument (eg. to
        // 'map(+, [1,2], [1,2]) => [2,4]
        return {
            abi: operatorAbi[id],
            name: id,
            _fill_type: _simple_copy_type
        }
    }

    // for docs
    if (!id && all) return syscalls;

    return syscalls[id];
}



export function make_syscall(name, args) {
    var syscall = lookup_syscall(name);
    if (!syscall)
        throw new InternalError(`no such syscall '${name}'`);
    return {
        op: 'func_call',
        name: {
            op: 'id',
            id: name,
            syscall
        },
        args,
        type: null
    };
}
