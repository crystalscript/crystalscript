
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ParserError,
    GeneralWarning,
} from './exceptions.js';

import ClarityCli from './ClarityCli.js';

const VERSION = "0.3.0";
const CLARITY_VERSION = "Clarity2";

const _scriptdir = path.dirname(fileURLToPath(import.meta.url));

const config_dir = path.join(
    process.env['XDG_CONFIG_HOME'] ||
    process.env['LOCALAPPDATA'] ||
        ( process.env['HOME'] ?
          path.join(process.env['HOME'], '.config') :
          "./"
        ),
    'crystalscript'
);


function usage(opts, msg) {
    if (msg)
        console.error(msg + '\n');

    console.log(`Crystalscript to Clarity compiler`);
    console.log('');
    console.log(`usage: crystalscript [options] source.crystal`);
    console.log('');
    console.log(`options:`);
    console.log(`   -c <config.json> path to config.json`);
    console.log(`   -o <file.clar>  output Clarity to file.clar (defaults to source.crystal.clar`);
    console.log(`   -s check syntax with clarity-cli`);
    console.log(`   -n|--contract-name <name>  specify a name for the deployed contract`);
    console.log(`   -v|--version show the version and exit`);
    console.log();
    console.log(`testing:`);
    console.log(`   -t run embedded tests with clarity-cli`);
    console.log(`   -T don't compile, but run embedded tests (.clar output file must exist)`);
    console.log(`   --no-newdb  reuse the existing clarity vm database`);
    console.log(`   --sender-addr <stx-addr>  id of contract owner`);
    console.log('');
    console.log(`To run tests or syntax check Clarity output, the clarity-cli program from a stacks-blockchain release must either be in your path, specified in config.json, or by setting the CLARITY_CLI environment variable.`);
    console.log('');
    console.log(`Current settings:`);
    var exists = fs.existsSync(opts.config_json_path) ? 'exists' : 'does not exist';
    console.log(`      config: ${opts.config_json_path} (${exists})`);
    console.log(` clarity_cli: ${opts.clarity_cli} (${opts.clarity_cli_probe().msg})`);
    console.log(`     tmp_dir: ${opts.tmp_dir}`);
    console.log('');
    process.exit(1);
}


export function process_cmdline() {

    var opts = get_c2c_opts( path.join(config_dir, 'config.json'), true );
    opts.src = null;

    var argi = 2;
    var remaining=() => process.argv.length - argi;
    var arg =(msg) => remaining() > 0 ? process.argv[argi] : usage(opts, msg);
    var next =() => ++argi;
    
    while (remaining() > 0) {
        if (arg() == '-o') {
            next();
            opts.clar_file = arg(`path to <file.clar> not given`); next();
        }
        else if (arg() == '-c') {
            next();
            var inpath = arg(`path to <config.json> not given`); next();
            var newopts = get_c2c_opts(inpath);
            opts = Object.assign(newopts, {
                syntax_check: opts.syntax_check,
                run_tests: opts.run_tests,
                compile: opts.compile,
                config_json_path: path.resolve(inpath)
            });
        }
        else if (arg() == '-s') {
            next();
            opts.syntax_check = true;
        }
        else if (arg() == '-t') {
            next();
            opts.run_tests = true;
        }
        else if (arg() == '-T') {
            next();
            opts.run_tests = true;
            opts.compile = false;
        }
        else if (arg() == '-d') {
            next();
            opts.debug = true;
        }
        else if (arg() == '--no-newdb') {
            next();
            opts.testing.newdb = false;
        }
        else if (arg() == '--sender-addr') {
            next();
            opts.testing.sender_addr = arg(`missing stx address`); next();
        }
        else if (arg() == '-n' || arg() == '--contract-name') {
            next();
            opts.contract_name = arg(`contract <name> not given`); next();
            if (/^S/.test(opts.contract_name)) {
                var s = opts.contract_name.split('.');
                opts.testing.sender_addr = s.shift();
                opts.contract_name = s.join('.');
            }
            if (/^\./.test(opts.contract_name))
                opts.contract_name = opts.contract_name.substr(1);
        }
        else if (arg() == "-v" || arg() == "--version") {
            console.log(`crystalscript ${VERSION} ${CLARITY_VERSION}`);
            process.exit(0);
        }
        else if (arg().substr(0,1) == "-") {
            usage(opts, `invalid option '${arg()}'`);
        }
        else {
            if (opts.src !== null)
                usage(opts, `unknown argument '${arg()}'`);
            
            opts.src = path.normalize(arg());
            next();
        }
    }
    
    if (opts.src === null) {
        usage(opts, `no source file given`);
    }

    if (! opts.clar_file)
        opts.clar_file = opts.src + '.clar';
    
    if (opts.contract_name) {
        opts.clar_import_file =
            path.join(path.dirname(opts.clar_file), opts.contract_name) +'.import';
    }

    return opts;
}




function get_c2c_opts(config_json_path, ignore_not_exists) {
    var config_json = load_config_json(config_json_path, ignore_not_exists);
    const tmp_dir = path.join(
        process.env['XDG_CACHE_HOME'] ||
        process.env['TEMP'] ||
            (process.env['HOME'] ?
             path.join(process.env['HOME'], '.cache') :
             "/tmp"),
        'crystalscript'
    );

    var opts = {
        clarity_cli: process.env['CLARITY_CLI'] || 'clarity-cli',
        tmp_dir,
        contract_name: null,
        testing: {
            newdb: true,
            sender_addr: null,
        },
        warning: function(...args) {
            var e = new GeneralWarning(...args);
            if (args.length == 1 && (args[0] instanceof ParserError)) {
                e = new GeneralWarning(args[0].node, args[0].get_message());
            }
            else if (args.length == 1 && (args[0] instanceof GeneralWarning)) {
                e = args[0];
            }
            console.error(''+e);
        }

    };
    Object.assign(opts, config_json, {
        compile: true,
        syntax_check: false,
        run_tests: false,
        src: null,
        clar_fd: null,
        clar_file: null,
        clar_import_file: null,
        clar_import_fd: null,
        config_json_path
    });

    opts.clarity_cli_probe = function() {
        if (path.isAbsolute(this.clarity_cli) &&
            !fs.existsSync(this.clarity_cli))
        {
            return { code:'ENOENT', msg:'does not exist' };
        }
        try {
            var cli = new ClarityCli(
                this.clarity_cli,
                path.join(this.tmp_dir, 'probe')
            );
            cli.generate_address();
            return { code:null, msg:'working' };
        } catch (e) {
            if (e.code == 'ENOENT') return { code:e.code, msg:'not found' };
            return { code:e.code, msg:''+e };
        }
    };


    return opts;
}

function load_config_json(config_json_path, ignore_not_exists) {
    var config_json = {};
    try {
        Object.assign(
            config_json,
            JSON.parse(fs.readFileSync(config_json_path).toString())
        );
    } catch (e) {
        if (e.code != 'ENOENT' || ! ignore_not_exists) {
            console.error(`${config_json_path}: ${e}`);
            throw e;
            process.exit(1);
        }
    }
    return config_json;
}
