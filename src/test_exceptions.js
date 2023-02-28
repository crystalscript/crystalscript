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

export class TestFailure extends Error {
    constructor(...s) {
        super(...s);
        this.name = 'TestFailure';
    }
};

export class TestDefinitionError extends Error {
    constructor(...s) {
        super(...s);
        this.name = 'TestDefinitionError';
    }
};

export class ClarityRuntimeError extends Error {
    constructor(status, json, ...args) {
        super(...args);
        this.name = 'ClarityRuntimeError';
        this.status = status;
        this.json = json;
    }
};
