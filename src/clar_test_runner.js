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

import path from 'node:path';
import ClarityCli from './ClarityCli.js';
import { safeStringify } from './ast_util.js';
import TestDefinition from './TestDefinition.js';

export const available_senders = [
    'ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P',
    "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH",
    "SPMP5QFV2GB8SG0P92QH6XEA9PKBETNN5HV0N303"
];


export function run_tests(opts, input) {
    // opts:
    //    clarity_cli: path to clarity-cli
    //    newdb: if true, create a new vmdb
    //    contract_library: load all contracts from this directory when newdb
    //    tmp_dir: path of temporary directory to use
    //    clar_file: path to .clar contract file
    //    sender_addr: stacks address of contract publisher (optional)
    //    contract_name: ".name" of contract (optional)
    //
    // input: the text of the .crystal file that corresponds to the
    //        .clar file and contains embedded TEST definitios
    //
    // returns: {
    //   num_success
    //   num_failure
    // }
    
    var cli = new ClarityCli(opts.clarity_cli, opts.clarity_db);

    var sender_addr = available_senders[0];
    if (opts.sender_addr) {
        if (Number.isNaN(opts.sender_addr)) {
            sender_addr = opts.sender_addr;
        }
        else {
            var idx = Number(opts.sender_addr);
            if (idx<0 || idx>=available_senders.length)
                throw new Error(`sender_addr by index: index must be between 0 and ${available_senders.length}`);
            sender_addr = available_senders[idx];
        }
    }

    if (opts.newdb) {
        console.log(`creating new clarity vm db '${path.basename(opts.clarity_db)}'`);
        cli.newdb(opts.contract_library);
    }


    var contract_name = `${sender_addr}.${opts.contract_name || 'test'}`;

    // deploy the contract
    cli.deploy_contract(contract_name, opts.clar_file);

    var lines = input.toString().split('\n');
    var rtn = {
        num_success: 0,
        num_failure: 0,
        count: 0
    };
    lines.forEach(line => {
        var match = line.match(/^\s*\/\/\s*TEST:\s*/);
        if (match) {
            var def = new TestDefinition(line.substr(match[0].length));
            console.log('');
            console.log(`test ${rtn.count+1}: ${def.pretty_call()}`);
            try {
                var output = def.run_test(
                    cli,
                    contract_name,
                    sender_addr
                );
                console.log(`  success: ${output.expect_response} and '${output.expect_expr}' is ${output.expr_result}`);
                ++rtn.num_success;
                if (opts.debug) {
                    console.log(`  output: ${safeStringify(output.fn_return)}`);
                }
            } catch(e) {
                console.log(`  failure: ${e}`);
                ++rtn.num_failure;
            }
            ++rtn.count;
        }
    });
    
    return rtn;
}
