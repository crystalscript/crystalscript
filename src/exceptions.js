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
    source_info
} from './ast_util.js';


export class ParserError extends Error {
    constructor() {
        super();
        this.name = 'ParserError';
        this._msg = 'Error';
        // first argument may be a "context", such as an ast node
        if (arguments.length > 0) {
            if (arguments.length==1 && typeof arguments[0] == 'string') {
                this._msg = arguments[0];
                this.node = null;
            }
            else {
                this.node = arguments[0];
                this._msg = arguments.length > 1 ? arguments[1] : 'Error';
            }
        }
        this.set_message(this._msg);
    }
    
    set_context(node) {
        // node: a context, such as an ast node
        this.node = node;
        this.set_message(this._msg);
    }

    set_message(msg) {
        this._msg = msg;
        var lines = [ this._msg ];
        if (this.node) {
            var info = source_info(this.node);
            if (info.line_detail) {
                lines.push(`at line ${info.line_detail.first_line}:${info.line_detail.first_column}`);
            }
            else if (info.line !== undefined) {
                lines.push(`at line ${info.line}`);
            }
        }
        this.message = lines.join(' ');
    }

    set_file(path) {
        if (this.node)
            this.message += ` of file ${path}`;
        else
            this.message += ` in ${path}`;
    }

    get_message() {
        return this._msg;
    }
};

export class InternalError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'InternalError';
    }
};
export class SyntaxError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'SyntaxError';
    }
};
export class RecursionError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'RecursionError';
    }
};
export class TypeMismatchError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'TypeMismatchError';
    }
};
export class SizeError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'SizeError';
    }
};
export class ArgumentError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'ArgumentError';
    }
};
export class ArgumentMismatchError extends ParserError {
    constructor(...args) {
        super(...args);
        this.name = 'ArgumentMismatchError';
    }
};
export class UndeterminedTypeError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'UndeterminedTypeError';
    }
};
export class UndefinedRuntimeTypeError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'UndefinedRuntimeTypeError';
    }
};
export class NotSupportedError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'NotSupportedError';
    }
};
export class MapKeyNotFoundError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'MapKeyNotFoundError';
    }
};
export class UndeclaredIdentifierError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'UndeclaredIdentifierError';
    }
};
export class AlreadyDeclaredError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'AlreadyDeclaredError';
    }
};
export class ReadOnlyViolationError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'ReadOnlyViolationError';
    }
};
export class ImportFileError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'ImportFileError';
    }
};
export class UnsetReponseTypeError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'UnsetResponseTypeError';
    }
};
export class DuplicateTraitFunctionError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'DuplicateTraitFunctionError';
    }
};
export class TraitFunctionMismatchError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'TraitFunctionMismatchError';
    }
};
export class TraitNotImplementedError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'TraitNotImplementedError';
    }
};
export class AmbiguousContractIdentifier extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'AmbiguousContractIdentifier';
    }
};
export class InvalidLiteralValueError extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'InvalidLiteralValueError';
    }
};
    

export class GeneralWarning extends ParserError{
    constructor(...args) {
        super(...args);
        this.name = 'Warning';
    }
};
