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

import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';
import { ClarityRuntimeError } from './test_exceptions.js';

import { cvToValue, cvToString, deserializeCV } from '@stacks/transactions';


export default class ClarityCli {
    constructor(path_to_clarity_cli, path_to_vmdb) {
        this.cli = path_to_clarity_cli;
        this.vmdb = path_to_vmdb;
        this.exec_opts = {
            stdio: [ 'inherit', 'pipe', 'pipe' ],
            timeout: 30 * 1000
        };
    }

    generate_address() {
        var result =
            child_process.spawnSync(
                this.cli, [ 'generate_address' ],
                this.exec_opts
            );
        if (result.error) throw result.error;
        if (result.status != 0) {
            throw new Error(`problem with generate_address - exit code ${result.status}`);
        }
        var json = JSON.parse(result.stdout.toString());
        return json.address;
    }

    newdb(contract_library, override_stx_addr) {
        fs.rmSync(this.vmdb, { recursive:true, force:true });
        fs.mkdirSync(path.dirname(this.vmdb), { recursive: true });
        var result =
            child_process.spawnSync(
                this.cli, [
                    'initialize',
                    this.vmdb
                ],
                this.exec_opts
            );
        if (result.error) throw result.error;
        var json = JSON.parse(result.stdout.toString());
        if (result.status != 0) {
            throw new Error(`unable to create db: ${result.stdout}`);
        }
        if (contract_library)
            this.load_all(contract_library, override_stx_addr);
    }

    load_all(dir, override_stx_addr) {
        var entries = fs.readdirSync(dir);
        entries.forEach(file => {
            if (!/\.clar$/.test(file)) return;
            // the file is exptected to be named stx_addr.name.clar
            var parts = file.split('.');
            var contract_name = null;
            if (parts.length == 3) {
                if (override_stx_addr) {
                    // if given, don't use the stx_addr from the file name
                    contract_name = `${override_stx_addr}.${parts[1]}`;
                }
                else {
                    contract_name = `${parts[0]}.${parts[1]}`;
                }
            }
            else if (parts.length == 2) {
                contract_name = '.' + parts[0];
            }
            else {
                contract_name = file.substr(0, file.length - 5);
            }
            this.deploy_contract(contract_name, path.join(dir, file), {
                quiet: true });
        });
    }

    deploy_contract(dotted_name, path_to_clar_file, opts) {
        // dotted_name must be "stx_addr.contract"
        if (! opts || !opts.quiet)
            console.log(`deploy ${path_to_clar_file} as ${dotted_name}`);
        var result =
            child_process.spawnSync(
                this.cli, [
                    'launch',
                    dotted_name,
                    path_to_clar_file,
                    this.vmdb
                ],
                this.exec_opts
            );
        if (result.error) throw result.error;
        if (result.status != 0) {
            throw new Error(`deploy contract failed: ${result.stdout} ${result.stderr}`);
        }
        var json = JSON.parse(result.stdout.toString());
        return json;
    }

    syntax_check(path_to_clar_file) {
        var result = child_process.spawnSync(
            this.cli, [
                'check',
                path_to_clar_file,
                this.vmdb
            ],
            this.exec_opts
        );
        if (result.error) throw result.error;
        if (result.status != 0) {
            if (result.stdout.toString().substr(0,1) == '{')
                throw new Error(`${result.stdout}`);
            else
                throw new Error(`${result.stderr}`);
        }
        var json = JSON.parse(result.stdout.toString());
        return json;
    }

    exec_public_function(dotted_contract_name, function_name, sender_address, args) {
        var cli_args = [
                'execute',
                this.vmdb,
                dotted_contract_name,
                function_name,
                sender_address,
        ];
        args.forEach(arg => { cli_args.push(arg); });

        var result =
            child_process.spawnSync(
                this.cli,
                cli_args,
                this.exec_opts
            );

        if (result.error) throw error;
        if (result.status != 0 && result.stderr.toString() != '') {
            throw new Error(`${result.stderr}`);
        }
        
        var json = JSON.parse(result.stdout.toString());
        
        //{"events":[],"message":"Transaction executed and committed.","output":{"Sequence":{"String":{"ASCII":{"data":[110,111]}}}},"output_serialized":"0d000000026e6f","success":true}
        // {"error":{"output":{"Int":1},"runtime":"Expected a ResponseType result from transaction."},"success":false}
        
        if (result.status != 0 && json.error && json.error.runtime)
            throw new ClarityRuntimeError(result.status, json, `exec contract function failed: ${result.stdout}`);
        else if (result.status != 0)
            throw new Error(`exec contract function failed: ${result.stdout}`);

        var cv = deserializeCV(json.output_serialized);
        json.val = cvToValue(cv);
        delete json.output_serialized;
        delete json.output;
        return json;
    }
}
