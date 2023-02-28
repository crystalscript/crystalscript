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
    TypeMismatchError,
    SizeError,
    ReadOnlyViolationError,
    TraitNotImplementedError,
    AmbiguousContractIdentifier
} from './exceptions.js';

import {
    optm_make_child,
    optm_move_node,
    optm_raise_child,
    optm_reset_node,
} from './ast_optimize.js';

import {
    my_scope_func_def,
} from './ast_scopes.js';

import {
    lookup_syscall,
    make_syscall
} from './ast_syscall.js';


export function source_info(node) {
    // get the source code line number associated with the node
    if (!node) return null;
    if (node.type == 'func') node=node.func_def;
    else if (node.type == 'syscall_ref') return null;
    var info = { };
    if (typeof node.line == 'object') {
        info.line = node.line.first_line;
        info.line_detail = node.line;
    }
    else {
        // may be undefined
        info.line = node.line;
    }
    return info;
}

const sequence_types = {
    'list': true,
    'string': true,
    'buff': true
};

export const optional_of_any_type =
    { type:'optional', itemtype:{ type:'*' } };

export const list_of_any_type =
    { type:'list', itemtype:{ type:'*' } };

export const trait_of_any_type =
    { type:'trait', itemtype:{ type:'*' } };

export const any_response =
    { type:'response' };

export const ok_response_of_any_type =
    { type:'response', oktype:{ type:'*' } };

export const err_response_of_any_type =
    { type:'response', errtype:{ type:'*' } };

export function copy_okerr_type(from_node, to_node) {
    if (from_node === undefined) from_node = { type:'runtime' };
    return copy_type(from_node, to_node);
}

export function copy_type(from_node, to_node, alt_from_node, deep)
{
    // deep: if "deep" make a deep copy instead of shallow
    //
    // alt_from_node: if supplied and from_node is type 'none' and
    //    alt_from_node is type 'optional', then copy alt_from_node
    //    instead of from_node. or, if from_node is type 'undefined',
    //    use alt node.

    if (! from_node) {
        throw new InternalError(to_node, `invalid argument`);
    }
    
    if (alt_from_node) {
        if (from_node.type === 'runtime')
            from_node = alt_from_node;
        else if (is_type_none(from_node) &&
                 equal_types(alt_from_node, optional_of_any_type))
        {
            from_node = alt_from_node;
        }
    }

    if (from_node.type === null) {
        throw new InternalError(from_node, `empty type '${safeStringify(from_node)}'`);
    }

    
    [ 'type', 'subtype', 'size', 'func_def', 'func_impl', 'syscall', 'decl' ]
        .forEach(key => {
            if (from_node[key] !== undefined) to_node[key] = from_node[key];
            else delete to_node[key];
        });
    [ 'itemtype', 'keytype', 'valtype', 'oktype', 'errtype' ]
        .forEach(key => {
            if (from_node[key] !== undefined) {
                if (deep) to_node[key] = copy_type(from_node[key], {});
                else to_node[key] = from_node[key];
            }
            else delete to_node[key];
        });
    
    if (from_node.maptype) {
        if (deep) {
            to_node.maptype = {};
            for (var key in from_node.maptype) {
                to_node.maptype[key] = copy_type(from_node.maptype[key], {});
            }
        }
        else {
            to_node.maptype = from_node.maptype;
        }
    }
    else delete to_node.maptype;
    
    return to_node;
}


export function is_sequence_type(type) {
    return sequence_types[type.type];
}

export function is_undetermined_type(type) {
    return (
        type.type === null ||
        type.itemtype === null ||
        type.maptype === null ||
        type.oktype === null ||    
        type.errtype === null
    );
}

export function node_is_typeless(node) {
    // a typeless node would be one like 'if'
    return node.type === undefined;
}

export function itemtype_of(type) {
    // get a sequence's implied (string,buff) or actual (list)
    // itemtype
    if (is_undetermined_type(type)) {
        throw new InternalError(from_node, `empty type`);
    }
    
    const buff_itemtype = {
        type:'buff',
        size:1
    };

    const string_itemtype = {
        type:'string',
        size:1
    };
    
    if (type.type == 'string') return string_itemtype;
    if (type.type == 'buff') return buff_itemtype;
    return type.itemtype;
}


export function equal_types(a, b, opts) {
    // when opts.strict is true:
    //
    //    1. 'a' must be the type whos maximum size cannot be
    //    exceeded (eg. the argument from a function defintion)
    //
    //    2. 'b' must be the type whos literal size must be smaller
    //    than 'a' maximum size (eg. the arg to the function call)
    //
    //    3. this function will throw SizeError if the literal in 'b'
    //    won't fit in 'a'
    //
    //    4. response in b must have an ok or err
    //

    // important: nodes should never have '*' as a type, that's only
    //    for matching. instead use null and undefined.
    //
    // nodes with type==null: the type is undetermined
    //
    // nodes with type=='runtime': the type cannot be determined
    //    until runtime

    opts = opts || {
        strict: false,
        runtime: false,
    };

    if (! opts.ctx_node)
        opts.ctx_node = b.line ? b : ( a.line ? a : null);
            
    if (a.type == '*' || b.type == '*')
        return true;

    if (a.type == '+' && b.type != 'optional' && b.type != 'none' ||
        b.type == '+' && a.type != 'optional' && a.type != 'none')
        return true;

    if (opts.runtime && (a.type == 'runtime' || b.type == 'runtime'))
        return true;

    if ((a.type == 'optional' && b.type == 'none' ||
         b.type == 'optional' && a.type == 'none'))
    {
        return true;
    }

    if (a.type == 'seq' && is_sequence_type(b) ||
        b.type == 'seq' && is_sequence_type(a))
    {
        return true;
    }
    
    if (opts.strict &&
        a.type == 'trait' && a.itemtype && b.type == 'extern_decl')
    {
        // the extern contract decl just needs to implement the trait
        var t_cid = contract_id_str_of_trait_type(a);
        var t_cid_abs = is_absolute_contract_id(t_cid);
        var implements_trait = false;
        var help = null;
        b.decl.defs.forEach(def => {
            if (implements_trait) return;
            if (def.op == 'extern_trait_def_impl') {
                if (def.impl_contract_id.val == t_cid)
                    implements_trait = true;
                else {
                    var def_cid_abs = is_absolute_contract_id(
                        def.impl_contract_id.val
                    );
                    if (t_cid_abs && ! def_cid_abs &&
                        t_cid.substr(-def.impl_contract_id.val.length) ==
                        def.impl_contract_id.val)
                    {
                        help = new AmbiguousContractIdentifier(opts.ctx_node, `ambiguous trait implementation match in '${b.decl.id}'. There is a '${def.impl_contract_id.val}' trait implementation in '${b.decl.id}', but the type expected is for a specific contract ('${t_cid}')`);
                    }
                    else if (! t_cid_abs && def_cid_abs &&
                             def.impl_contract_id.val.substr(- t_cid.length) ==
                             t_cid)
                    {
                        help = new AmbiguousContractIdentifier(opts.ctx_node, `Ambiguous trait implementation match in '${b.decl.id}'. There is a '${def.impl_contract_id.val}' trait implementation in '${b.decl.id}', but the type expected is for a relative contract ('${t_cid}')`);
                    }
                }
            }
        });
        if (! implements_trait) {
            if (help) throw help;
            else throw new TraitNotImplementedError(opts.ctx_node, `'${b.decl.id}' does not implement trait '${t_cid}'${help ? '. '+help : ''}`);
        }
        return true;
    }
    
    if (a.type != b.type)
        return false;

    if (opts.strict &&
        b.size !== undefined &&
        a.size !== undefined &&
        b.size !== '*' &&
        a.size !== '*' &&
        b.size > a.size)
    {
        throw new SizeError(opts.ctx_node, `${opts.help_txt || 'item'} of type '${pretty_type(b)}' exceeds the maximum size (${a.size})`);
    }

    // list, optional, trait
    if (a.itemtype && !b.itemtype || !a.itemtype && b.itemtype)
        return false;
    
    if (a.itemtype) {
        if (a.type == 'list') opts.help_txt = `list element`;
        else if (a.type == 'trait') opts.help_txt = `trait`;
        else opts.help_txt = 'optional';
        return equal_types(a.itemtype, b.itemtype, opts);
    }

    // map
    if (opts.strict && a.type == 'map') {
        if (a.maptype && !b.maptype || !a.maptype && b.maptype)
            return false;
        if (!a.maptype) return false;
        if (a.maptype == '*' || b.maptype == '*')
            return true;
        for (var key in a.maptype) {
            if (b.maptype[key] === undefined)
                return false;
            opts.help_txt = `map key '${key}'`;
            if (! equal_types(a.maptype[key], b.maptype[key], opts))
                return false;
        }
        for (var key in b.maptype) {
            if (a.maptype[key] === undefined)
                return false;
        }
        return true;
    }

    // response
    if (a.type == 'response') {
        var ok = false;
        var err = false;

        // undefined: don't care
        // *: has to exist

        if (a.oktype && !b.oktype)
            // type <=> unknown
            ok = a.oktype.type != '*';
        else if  (!a.oktype && b.oktype)
            // unknown <=> type
            ok = b.oktype.type != '*'
        else if (a.oktype && b.oktype) {
            // type <=> type
            opts.help_txt = 'ok';
            ok = equal_types(a.oktype, b.oktype, opts);
        }
        else {
            // unknown <=> unknown
            ok=true;
        }

        if (a.errtype && !b.errtype)
            // type <=> unknown
            err = a.errtype.type != '*';
        else if (!a.errtype && b.errtype)
            // unknown <=> type
            err = b.errtype.type != '*';
        else if (a.errtype && b.errtype) {
            // type <=> type
            opts.help_txt = 'err';
            err = equal_types(a.errtype, b.errtype, opts);
        }
        else
            // unknown <=> unknown
            err=true;

        // if strict the response must have an ok or err, or both.
        if (opts.strict) {
            if (!b.oktype && !b.errtype)
                ok = false;
        }
        
        return ok && err;        
    }
    
    return true;
}

export function equal_types_strict(a, b, other_opts) {
    var opts = {
        runtime: false
    };
    if (other_opts) Object.assign(opts, other_opts);
    opts.strict = true;
    return equal_types(a, b, opts);
}

export function is_type_none(a) {
    return a.type == 'none';
}

export function ensure_equal_types(type_a, type_b, opts, color) {
    if (! equal_types(type_a, type_b, opts)) {
        throw new TypeMismatchError(opts && opts.ctx_node || type_a, `${color ? color+'. ': ''}the types '${pretty_type(type_a)}' and '${pretty_type(type_b)}' are incompatible`);
    }
    return true;
}

export function ensure_type(type, expected_type, opts, color) {
    if (! equal_types(type, expected_type, opts)) {
        throw new TypeMismatchError(opts && opts.ctx_node || type, `${color ? color+'. ': ''}unsupported type. expected type '${pretty_type(expected_type)}' but got '${pretty_type(type)}'`);
    }
    return true;
}

export function type_is_one_of(type, valid_types, opts) {
    var match = null;
    valid_types.forEach(valid_type => {
        if (match) return;
        if (equal_types(type, valid_type, opts)) match=valid_type;
    });
    return match;
}

export function ensure_type_is_one_of(type, valid_types, opts, color) {
    if (valid_types.length == 1) {
        return ensure_type(type, valid_types[0], opts, color);
    }
    if (! type_is_one_of(type, valid_types, opts)) {
        throw new TypeMismatchError(opts && opts.ctx_node || type, `${color ? color+'. ': ''}unsupported type. expected one of '${pretty_args(valid_types)}' but got '${pretty_type(type)}'`);
    }
    return true;
}


export function merge_response_types(from_type, to_type) {
    if (from_type.type != 'response' || to_type.type != 'response') {
        return false;
    }
    
    if (from_type.oktype && to_type.oktype) {
        if (equal_types(from_type.oktype, optional_of_any_type) &&
            is_type_none(to_type.oktype))
        {
            copy_type(from_type.oktype, to_type.oktype);
        }
        else if (! equal_types(from_type.oktype, to_type.oktype)) {
            throw new TypeMismatchError(`response ok types differ`);
        }
    }
    else if (from_type.oktype && !to_type.oktype) {
        to_type.oktype = copy_okerr_type(from_type.oktype, {});
        return true;
    }
    
    if (from_type.errtype && to_type.errtype) {
        if (equal_types(from_type.errtype, optional_of_any_type) &&
            is_type_none(to_type.errtype))
        {
            copy_type(from_type.errtype, to_type.errtype);
        }
        if (! equal_types(from_type.errtype, to_type.errtype)) {
            throw new TypeMismatchError(`response err types differ`);
        }
    }
    else if (from_type.errtype && !to_type.errtype) {
        to_type.errtype = copy_okerr_type(from_type.errtype, {});
        return true;
    }
    return false;
}

export function coerce_literal(node, to_type) {
    if (node.op != 'lit') {
        return false;
    }
        
    if (equal_types(node, {type:'int'}) &&
        equal_types(to_type, {type:'uint'}))
    {
        // ** int to uint
        if (node.val >= 0n) {
             copy_type(to_type, node);
            return true;
        }
    }
    else if (equal_types(node, {type:'uint'}) &&
             equal_types(to_type, {type:'int'}))
    {
        // ** uint to int
        if (node.val < 0x80000000000000000000000000000000n) {
            // clarity max uint is 128-bits
            copy_type(to_type, node);
            return true;
        }
    }
    else if (equal_types(node, {type:'string'}) &&
             equal_types(to_type, {type:'principal'})) {
        // ** string to principal
        copy_type(to_type, node);
        delete node.size;
        return true;
    }
    return false;
}


export function coerce_to_optional(node) {
    if (equal_types(node, optional_of_any_type))
        return false;
    optm_make_child(node, "a", { op:'optional' } );
    copy_type({ type:'optional', itemtype:node.a }, node);
    return true;
}

function unwrap_optional_with(name, ...node) {
    function get_call_args(unwrap_node) {
        if (name == 'unwrap-panic') {
            return [ unwrap_node ];
        }
        else if (name == 'default-to') {
            return [
                {op:'lit', type:'none', subtype:'keyword', val:'none' },
                unwrap_node
            ];
        }
        else {
            throw new InternalError(`${name} is not a supported function`);
        }
    }
    
    node.forEach(n => {
        if (equal_types(n, optional_of_any_type)) {
            if (is_type_none(n)) {
                // can't unwrap a none
                return;
            }
            if (name == 'unwrap-panic' && n.op == 'optional') {
                // unwrap-panic(optional(n)) => n
                optm_raise_child(n, "a");
            }
            else {
                var optional = optm_move_node(n, {});
                Object.assign(n, {
                    op: 'func_call',
                    name: { op:'id', id:name, syscall:lookup_syscall(name) },
                    args: get_call_args(optional),
                    line: optional.line
                })
                delete optional.line;
                copy_type(optional.itemtype, n);
            }
        }        
    });
}

export function unwrap_optional(...node) {
    unwrap_optional_with('unwrap-panic', ...node);
}

export function unwrap_optional_with_default_to(...node) {
    unwrap_optional_with('default-to', ...node);
}


export function coerce_func_call_args(func_def, func_call) {
    if (func_def.args.length != func_call.args.length) {
        return;
    }    
    func_def.args.forEach((arg_def, idx) => {
        var arg_call = func_call.args[idx];
        coerce_literal(arg_call, arg_def);
        if (equal_types(arg_def, optional_of_any_type) &&
            ! equal_types(arg_call, optional_of_any_type))
        {
            coerce_to_optional(arg_call);
        }        
    });
}

function _coerce_lit_map_values(mapdef, map, map_maptype) {
    // mapdef: typedef of 'map'
    // map: the literal map
    // map_maptype: the typedef determination map of 'map'
    for (var key in map) {
        if (! mapdef[key]) continue;
        if (equal_types(mapdef[key], { type:'map' }) &&
            equal_types(map[key], { type:'map' }))
        {
            _coerce_lit_map_values(mapdef[key].maptype, map[key].val, map_maptype[key].maptype);
            return;
        }

        var val_is_optional = equal_types(map[key], optional_of_any_type);
        var def_is_optional = equal_types(mapdef[key], optional_of_any_type);
        if ( val_is_optional && ! def_is_optional) {
            unwrap_optional(map[key]);
            coerce_literal(map[key], mapdef[key]);
            copy_type(map[key], map_maptype[key]);
        }
        else if ( !val_is_optional && def_is_optional) {
            coerce_to_optional(map[key]);
            copy_type(map[key], map_maptype[key]);
        }
        else {
            coerce_literal(map[key], mapdef[key]);
            copy_type(map[key], map_maptype[key]);
        }
    }
}

export function coerce_lit_map_values(mapdef, maplit_node) {
    if (maplit_node.op != 'lit') return;
    if (!equal_types(maplit_node, { type:'map' })) return;
    if (!equal_types(mapdef, { type:'map' })) return;
    _coerce_lit_map_values(mapdef.maptype, maplit_node.val, maplit_node.maptype);
}



export function ensure_no_readonly_violation(func_def_calling, scopes, context_node) {
    // func_def_calling: function that's being called, which should
    // not return response ok when the current scope is read-only
    if (!func_def_calling) return;

    var myscope_func_def = my_scope_func_def(scopes, context_node);
    if (!myscope_func_def) {
        // occurs when processing 'const var=expr' at the root level
        // -- because it's not in a function
        return;
    }
       
    if (equal_types(func_def_calling, ok_response_of_any_type) &&
        (myscope_func_def.vis == 'read-only'))
    {
        if (! func_def_calling.errtype) {
            throw new ReadOnlyViolationError(context_node, `call to write-only function '${func_def_calling.name}' from a read-only function`);
        }
        else {
            throw new ReadOnlyViolationError(context_node, `call to function '${func_def_calling.name}' that performs writes from a read-only function`);
        }
    }
}


export function is_absolute_contract_id(contract_id) {
    if (!contract_id) throw new InternalError(`undefined contract id`);
    if (typeof contract_id == 'string')
        return contract_id.substr(0,1)=='S';
    else
        return contract_id.val.substr(0,1)=='S';
}

export function contract_id_str_of_trait_type(type) {
    // trait<trait_def.trait-name> or trait<principal>
    // itemtype is an expression
    if (equal_types(type.itemtype, { type:'principal' })) {
        return type.itemtype.val;
    }
    else if (equal_types(type.itemtype, { type:'trait_def' })) {
        var trait_def = type.itemtype.decl;
        return trait_def.contract_id.val + '.' + trait_def.id;
    }
    else {
        throw new InternalError(type, `not a valid trait itemtype`);
    }
}
    

export function pretty_type(type, for_machines) {
    if (! type) return '';
    if (type.itemtype) {
        if (type.type == 'optional')
            return `optional ${pretty_type(type.itemtype)}`;
        else if (type.type == 'trait')
            return `trait<${contract_id_str_of_trait_type(type)}>`;
        else if (for_machines && type.type == 'list' && type.itemtype=='-')
            // empty list
            return `${type.type}<>`;
        else if (type.size !== undefined)
            return `${type.type}<${pretty_type(type.itemtype)}>[${type.size}]`;
        else
            return `${type.type}<${pretty_type(type.itemtype)}>`;
    }
    if (type.size !== undefined) {
        return `${type.type}[${type.size}]`;
    }
    if (type.type == 'response') {
        var oktype = pretty_type(type.oktype);
        var errtype = pretty_type(type.errtype);
        if (oktype && errtype || for_machines)
            return `response<${oktype || ''},${errtype || ''}>`;
        else if (oktype)
            return `ok(${oktype})`;
        else if (errtype)
            return `err(${errtype})`;
        else
            return `response`;
    }
    if (type.type == 'map') {
        var output = [];
        for (var key in type.maptype) {
            var valtype = pretty_type(type.maptype[key]);
            output.push(`${key}:${valtype}`);
        }
        return '{'+output.join(',')+'}';
    }
    if (type.type == 'seq') {
        return `sequence (eg. ${Object.keys(sequence_types).join(',')})`;
    }
    return type.type;
}

export function pretty_args(args, for_machines) {
    var p = [];
    args.forEach(arg => {
        p.push(pretty_type(arg, for_machines));
    });
    return p.join(',');
}

export function pretty_op(node) {
    if (node.type == 'func') return 'function';
    if (node.type == 'syscall_ref') return 'system function';
    if (node.op == 'vardecl') return node.protect; // eg 'const'
    if (node.op == 'func_def') return 'function';
    if (node.op == 'persist') return node.access; // eg 'datamap'
    if (node.op == 'trait_def') return 'trait';
    if (node.op == 'use_trait') return 'trait';
    if (node.op == 'declare_extern') return 'extern';
    if (node.op == 'extern_func_def') return 'extern function';
    return node.op;
}

export function find_first_return(body) {
    var found = null;
    walk_cb(body, node => {
        if (found) return false;
        if (node.op == 'return') found = node;
        return !found;
    });
    return found;
}

export function truthy_node(node) {
    if (equal_types(node, optional_of_any_type)) {
        if (is_type_none(node)) {
            optm_reset_node(node,
                            { op:'lit',type:'bool', val:false });
        }
        else {
            // using 'is-some' is a little more compact:
            //    (is-some <node>)
            optm_reset_node(
                node,
                make_syscall('is-some', [ optm_move_node(node, {}) ]),
            );
            node.type = 'bool';

            // versus:
            //    (not (is-none <node>))
            //
            // optm_reset_node( node, {
            //     op: '!=',
            //     type: 'bool',
            //     a: optm_move_node(node, {}),
            //     b: { op:'lit', type:'none', val:null }
            // });
        }
    }
}


export function walk_cb(node, cb, cb_arg) {
    if (Array.isArray(node)) {  // body, args, etc
        node.forEach(n => {
            if (cb(n, cb_arg)) walk_cb(n, cb, cb_arg);
        });
    }
    else if (typeof node == 'object') { // expr, etc
        for (var k in node) {
            if (node[k]!==null &&
                typeof(node[k]) == 'object' &&  // includes Array
                // don't traverse decl references, they're already in the tree
                k != 'func_def' &&
                k != 'syscall' &&
                k != 'decl' &&
                cb(node[k], cb_arg))
            {
                walk_cb(node[k], cb, cb_arg);
            }
        }
    }
}


export function safeStringify(node, key_filter, spacing) {
    var kf = null;
    if (Array.isArray(key_filter)) {
        kf = {};
        key_filter.forEach(k => { kf[k] = true });
    }
    
    function filterfn(key, value) {
        if (kf && key!='' && Number.isNaN(Number(key)) && ! kf[key]) {
            return undefined;
        }
        else if (typeof key_filter == 'function') {
            value = key_filter.call(this, key, value);
        }
        
        if (value !== null && value !== undefined && (typeof value.valueOf() == 'bigint'))
            return Number(value);
        else
            return value;
    }
    
    var json = JSON.stringify(node, filterfn, spacing);
    return json;
}

export function dump(node, exit, msg, keys) {
    function ast_dump_filter(key, value) {
        if (key=='line') return undefined;
        if (key=='decl') return `{ op='${value.op}', contract_id=${value.contract_id}, ...}`;
        if (key=='func_def') return `{ op='${value.op}', name='${value.name}', ...}`;
        if (key=='syscall') return `{ name='${value.name}', ... }`;
        if (key=='vars_declared' || key=='funcs_declared')
            return Object.keys(value);
        if (key=='type') return pretty_type(this);
        if (key=='oktype' || key=='errtype' || key=='maptype') return undefined;
        return value;
    }
    if (keys === undefined) keys = ast_dump_filter;
    console.log(`${msg ? msg + ': ' : ''}${safeStringify(node, keys, 4)}`);
    if (exit) throw Error('exit - dump');
}
