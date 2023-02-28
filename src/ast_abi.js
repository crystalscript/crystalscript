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
    ArgumentError,
    InternalError,
    TypeMismatchError,
    ArgumentMismatchError,
} from './exceptions.js';

import {
    equal_types,
    equal_types_strict,
    optional_of_any_type,
    is_sequence_type,
    unwrap_optional,
    pretty_type,
    pretty_args,
} from './ast_util.js';


export default class Abi {
    constructor(function_name, abi) {
        this.function_name = function_name;
        this.abi = Array.isArray(abi) ? abi : [ abi ];
    }

    match_func_call(func_call, opts) {
        // returns matching abi_entry, or throws
        return this.validate_args(func_call, func_call.args, opts);
    }

    validate_args(context, args, opts) {
        // returns matching abi_entry, or throws
        try {
            var first_error = null;
            for (var idx=0; idx<this.abi.length; idx++) {
                var abi_entry = this.abi[idx];
                try {
                    this.validate_entry_args(abi_entry, args, opts);
                    return abi_entry;
                } catch(e) {
                    if (! (e instanceof ParserError)) throw e;
                    if (e instanceof InternalError) throw e;
                    if (!first_error) first_error = e;
                }
            }
            if (this.abi.length == 1) throw first_error;
            throw new ArgumentMismatchError(`no suitable call to ${this.function_name} could be found having arguments of type ${pretty_args(args)}`);
        }
        catch(ex)
        {
            if (ex instanceof ParserError) ex.set_context(context);
            throw ex;
        }
    }

    
    entry_args_count(abi_entry) {
        var min = 0;
        var unlim = false;
        abi_entry.args.forEach(abi_arg => {
            if (unlim) return;
            if (abi_arg == '...') unlim = true;
            else ++min;
        });
        return { min, max: unlim ? -1 : min };
    }
    
    validate_entry_num_args(abi_entry, args) {
        // validate the number of arguments given against expected
        var expected = this.entry_args_count(abi_entry);
        if (args.length < expected.min) {
            throw new ArgumentError(`too few arguments to '${this.function_name}'. expected ${expected.min} but only got ${args.length}`);
        }
        if (expected.max != -1 && args.length > expected.max) {
            throw new ArgumentError(`too many arguments to '${this.function_name}'. expected ${expected.max} but got ${args.length}`);
        }
        return true;
    }
    
    validate_entry_args(abi_entry, args, opts) {
        // validate both number of args and their types. every arg
        // must have a pre-determined type.  if opts.unwrap_optionsl
        // is true, optional args will be unwrapped to make a match.
        this.validate_entry_num_args(abi_entry, args);

        var abiargs = abi_entry.args;
        var arg_idx = 0;
        var abiarg_idx = 0;
        var args_requiring_unwrap=[];
        
        while(arg_idx<args.length && abiarg_idx<abiargs.length) {
            var abiarg = abiargs[abiarg_idx];
            var arg = args[arg_idx];
            if (abiarg == '...') {
                if (abiarg_idx == abiargs.length - 2) {
                    // zero or more of type designated by the entry after '...'
                    abiarg = abiargs[abiarg_idx + 1];
                }
                else if (abiarg_idx == abiargs.length -1) {
                    // 1 or more of type designated by the entry before '...'
                    abiarg = abiargs[abiarg_idx - 1];
                }
                else {
                    throw new InternalError(`invalid abi args format using '...' abi=${JSON.stringify(abi_entry)}`);
                }
            }
            else {
                ++abiarg_idx;
            }

            var same = false;
            if (abiarg.type == '*') {
                // ok
                same = true;
            }
            else {
                var abitypes = Array.isArray(abiarg.type) ?
                    abiarg.type : [ abiarg ];
                
                abitypes.forEach(abitype => {
                    if (!same) {
                        abitype =  typeof abitype == 'string' ?
                            { type: abitype } : abitype;

                        if (opts && opts.unwrap_optional &&
                            equal_types(arg, optional_of_any_type) &&
                            ! equal_types(abitype, optional_of_any_type) &&
                            equal_types_strict(abitype, arg.itemtype))
                        {
                            // works with unwrap
                            same = true;
                            args_requiring_unwrap.push(arg_idx);
                        }
                        else {
                            same = equal_types_strict(abitype, arg);
                        }
                    }
                });
            }
            
            if (! same) {
                throw new TypeMismatchError(`argument ${arg_idx+1} to ${this.function_name} is a '${pretty_type(arg)}' but expected '${pretty_type(abiarg)}'`);
            }
            
            ++arg_idx;
        }
        if (arg_idx != args.length) {
            throw new ArgumentError(`too many arguments for ${this.function_name}`);
        }
        if (abiarg_idx != abiargs.length && abiargs[abiarg_idx] != '...') {
            throw new ArgumentError(`too few arguments for ${this.function_name}`);
        }

        if (opts && opts.unwrap_optional) {
            args_requiring_unwrap.forEach(arg_idx => {
                unwrap_optional(args[arg_idx]);
            });
        }
        return true;
    }

};

