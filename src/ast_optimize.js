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
    InternalError
} from './exceptions.js';


export function optm_reset_node(node, newvalues) {
    // clear node of all keys and values
    for (var key in node) {
        delete node[key];
    }
    if (newvalues) Object.assign(node, newvalues);
}

export function optm_move_node(from_node, to_node) {
    // moves all keys from -> to
    optm_reset_node(to_node);
    Object.assign(to_node, from_node);
    optm_reset_node(from_node);
    return to_node;
}

export function optm_make_child(node, child_key, new_node) {
    // make 'node' a child at child_key, then copy 'new_node' to node.
    //
    // 'node' will be modified so that it will have a single key
    // (child_key) which has the properties that were part of 'node'
    // plus any key/values from 'new_node'
    //
    var new_child = {};
    optm_move_node(node, new_child);
    if (new_node) Object.assign(node, new_node);
    node[child_key] = new_child;
    node.optm = `i:${child_key}`; // inserted and moved to child_key
}

export function optm_raise_child(node, child_key) {
    // replace the parent with the child
    var child = node[child_key];
    if (! child) {
        throw new InternalError(node, `no child at '${child_key}'`);
    }
    child.optm = `r:${node.op}`; // raised & replaced node.op
    optm_reset_node(node);
    Object.assign(node, child);
}


function _remove_unreachable(body) {
    if (!body) return;
    var unreachable_code = false;
    body.forEach(stmt => {
        if (unreachable_code) {
            stmt.op = 'nop';
        }
        else if (stmt.op == 'return') {
            unreachable_code = true;
        }
        else if (stmt.op == 'func_def' || stmt.op == 'anon_func_def') {
            _remove_unreachable(stmt.body);
        }
        else if (stmt.op == 'if') {
            _remove_unreachable(stmt.body);
            _remove_unreachable(stmt.else_body);
        }
    });
}

export function optm_remove_unreachable(ast) {
    ast.forEach(definition => {
        if (definition.op == 'func_def' || definition.op == 'anon_func_def') {
            _remove_unreachable(definition.body);
        }
    });
}

function _remove_nop(body) {
    // right now, these only appear at the stmt level
    if (!body) return null;
    var newbody = [];
    body.forEach(stmt => {
        if (stmt.op == 'func_def' || stmt.op == 'anon_func_def') {
            stmt.body = _remove_nop(stmt.body);
        }
        else if (stmt.op == 'if') {
            stmt.body = _remove_nop(stmt.body);
            stmt.else_body = _remove_nop(stmt.else_body);
        }

        if (stmt.op != 'nop') {
            newbody.push(stmt);
        }
    });
    return newbody;
}

export function optm_remove_nop(ast) {
    _remove_nop(ast);
}


export function optm_remove_from_array(arr, indexes) {
    indexes.sort();
    indexes.reverse();
    indexes.forEach(idx => {
        arr.splice(idx, 1);
    })
}
