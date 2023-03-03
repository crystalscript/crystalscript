import {
    InternalError
} from './exceptions.js';


// stacks-blockchain/clarity/src/vm/types/mod.rs
export const MAX_VALUE_SIZE = 1024n * 1024n; // 1MB
export const CHAR_SIZE = 4n;
export const NUMBER_SIZE = 16n;
export const BOOL_SIZE = 1n; // ??
export const STX_ADDRESS_LENGTH = 41n;

export function get_type_unit_size(type) {
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

export function get_max_list_size(itemtype) {
    if (itemtype.type == '-') return 0;
    // approximation
    return MAX_VALUE_SIZE / get_type_unit_size(itemtype) - 100n; //8n;
}

