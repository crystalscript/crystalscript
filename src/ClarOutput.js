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
} from './exceptions.js';



class ClarOutputFormatter {
    constructor() {
        // each entry is a new line of output
        this.output = [{
            line: [], // text to be joined with space
            indent: [0] // cumulative indent stack
        }];
    }
    
    push(...txt) {
        // push new output text to be part of the current line of output
        var cur = this.output[this.output.length-1];
        txt.forEach(t => {
            t = ''+t;
            if (t == ')') {
                var last = cur.line.length-1;
                if (last>=0) {
                    // concat the close paren to previous text element
                    cur.line[last] += t;
                }
                else {
                    // add as new element
                    cur.line.push(t);
                }
                cur.indent.pop();
            }
            else {
                var last = cur.line.length-1;
                var last_indent = cur.indent.length-1;

                var cstart = t.indexOf(';;');
                var t_clean = t;
                if (cstart != -1) t_clean = t.substr(0, cstart).trimRight();
                
                if (cur.line.length >0 && cur.line[0].substr(0,1)=='(' ||
                    t=='(')
                {
                    // don't add to indent if the line isn't a list
                    cur.indent[last_indent] += t_clean.length;
                }

                if (last>=0 && cur.line[last].substr(-1)=='(') {
                    // combine the open paren and text as single element
                    cur.line[last] += t;
                }
                else {
                    // otherwise add new element
                    cur.line.push(t);
                    if (cur.line.length>1 && cstart !=0)
                        cur.indent[last_indent]++; // for space char
                }
                if (t=='(') {
                    --cur.indent[last_indent];
                    cur.indent.push(cur.indent[last_indent] +1);
                }
            }
        });
    }

    newline(n, allow_repeats) {
        // n: adjustment to indentation for the new line
        // allow_repeats: if truthy, allow multiple back-to-back newlines
        var cur = this.output[this.output.length-1];
        if (n !== undefined && n<0) {
            cur.indent[cur.indent.length-1] =
                Math.max(3, cur.indent[cur.indent.length + n - 1]);
        }
        else if (n !== undefined && cur.indent.length>2) {
            cur.indent[cur.indent.length-1] = 
                cur.indent[cur.indent.length-2] + n; //cur.indent[0] + n;
        }
        else if (n !== undefined) {
            cur.indent[cur.indent.length-1] = n;
        }

        if (allow_repeats || cur.line.length>0) {
            this.output.push({
                line: [],
                indent: cur.indent.concat([])
            });
        }
    }
    
    toString() {
        var lines = [];
        this.output.forEach((line_group, idx) => {
            var line = line_group.line.join(' ');
            var indent = 0;
            if (idx>0) indent = this.output[idx-1].indent.pop();
            lines.push(' '.repeat(indent) + line);
        });
        return lines.join('\n');
    }
};



class ClarOutputBase {
    constructor(associated_node) {
        // associated_node: include comments from this node
        this.c = null // comments
        if (typeof associated_node == 'string' ||
            (associated_node instanceof ClarOutputBase))
        {
            throw new InternalError(`invalid associated_node`);
        }
        // comments
        if (associated_node) this.c = associated_node.c;
    }
    fmt_nl(indent) {
        this.line_break = true;
        this.line_break_indent = indent;
        return this;
    }
    prepend_comments(c) {
        if (!c) return;
        if (! this.c) this.c = c;
        else this.c = c.concat(this.c);
    }
    move_comments(to_claroutput) {
        to_claroutput.c = this.c;
        this.c = null;
    }
    toString(ctx) {
        throw new InternalError(`not implemented`);
    }

};

export class ClarList extends ClarOutputBase {
    constructor(associated_node, ...output_items) {
        super(associated_node);
        this.items = [];
        this.add(...output_items);
    }
    add(...items) {
        items.forEach(item => {
            if (Array.isArray(item)) {
                this.add(...item);
            }
            else {
                this.items.push(item);
            }
        });
        return this;
    }
    count() {
        return this.items.length;
    }
    shift() {
        this.items.shift();
    }
    top() {
        if (this.items.length == 0) return null;
        return this.items[this.items.length -1];
    }
    bottom() {
        if (this.items.length == 0) return null;
        return this.items[0];
    }
    
    is_clar_expr(name, min_length) {
        var minlen = Math.max(1, min_length || 1);
        var ok = this.items.length>=minlen && (typeof this.items[0] == 'string') && this.items[0] == name;
        if (minlen>=2)
            return ok && (this.items[1] instanceof ClarList);
        else
            return ok;
    }
    
    optimize_double_not() {
        // (not (not expr)) => expr
        if (this.is_clar_expr('not', 2) && this.items[1].is_clar_expr('not')) {
            if (this.items[1].items[1] instanceof ClarList) {
                this.items = this.items[1].items[1].items;
            }
            else {
                // 'expr' is a literal - we are unable to take on a
                // different class type so can't optimize
            }
        }
    }
    
    optimize_double_begin() {
        // (begin (begin a b c ...) aa bb ...) => (begin a b c ... aa bb ...)
        if (this.is_clar_expr('begin', 2) &&
            this.items[1].is_clar_expr('begin'))
        {
            var newitems = ['begin'];
            for (var idx = 1; idx<this.items[1].items.length; idx++) {
                newitems.push(this.items[1].items[idx]);
            }
            for (var idx = 2; idx<this.items.length; idx++) {
                newitems.push(this.items[idx]);
            }
            this.items = newitems;
        }
    }

    optimize_not_issome() {
        // (not (is-some x)) => (is-none x)
        if (this.is_clar_expr('not', 2) &&
            this.items[1].is_clar_expr('is-some')) {
            this.items[0] = 'is-none';
            this.items[1] = this.items[1].items[1];
        }
    }
    
    
    toString(ctx) {
        this.optimize_double_not();
        this.optimize_double_begin();
        this.optimize_not_issome();

        var return_str = ( ctx === undefined );
        ctx = ctx || new ClarOutputFormatter();
        
        var indent = this.line_break_indent;
        if (this.c && this.c.length>0) {
            this.c.forEach(comment => {
                ctx.newline(indent);
                ctx.push(comment);
                indent = undefined;
            });
            ctx.newline(indent);
        }

        if (this.line_break) ctx.newline(indent);
        ctx.push('(');
        this.items.forEach(item => {
            if (item instanceof ClarOutputBase) {
                item.toString(ctx);
            }
            else {
                ctx.push(item);
            }
        });
        ctx.push(')');

        if (return_str) return ctx.toString();
    }
};


export class ClarListLit extends ClarOutputBase {
    constructor(associated_node, txt) {
        super(associated_node);
        this.txt = txt;
        if (this.c) this.fmt_nl();
    }
    toString(ctx) {
        var return_str = ( ctx === undefined );
        ctx = ctx || new ClarOutputFormatter();

        if (this.c && this.c.length==1) {
            if (this.line_break) ctx.newline(this.line_break_indent);
            ctx.push(this.txt, this.c[0]);
            ctx.newline();
        }
        else if (this.c && this.c.length>1) {
            var indent = this.line_break_indent;
            this.c.forEach(comment => {
                ctx.newline(indent);
                ctx.push(comment);
                indent = undefined;
            });
            ctx.newline(indent);
            ctx.push(this.txt);
        }
        else {
            if (this.line_break) ctx.newline(this.line_break_indent);
            ctx.push(this.txt);
        }

        if (return_str) return ctx.toString();
    }
};

