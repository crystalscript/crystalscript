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
    source_info,
    walk_cb,
    dump
} from './ast_util.js';


export function ast_merge_comments(ast, comments) {
    // ast: output from the crystal-ast compiler
    // comments: an array. output from the comments compiler (see
    // crystal-comments.jison)
    var cidx = 0;
    walk_cb(ast, node => {
        if (cidx >= comments.length) return false;
        var line = source_info(node).line;
        if (line) {
            while (cidx < comments.length && line >= comments[cidx].line) {
                if (! node.c) node.c = [];
                node.c.push(comments[cidx++].c);
            }
        }
        return true;
    });

    // returns any comments that come after the last func_def
    return comments.slice(cidx);
}

export function add_comment(node, comment) {
    // node: ast node to add a comment to
    // comment: string
    if (!node.c) node.c = [ comment ];
    else node.c.push(comment);
}
