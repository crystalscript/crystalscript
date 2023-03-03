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
import { fileURLToPath } from 'node:url';

import {
    ParserError,
    InternalError,
    ImportFileError,
    TraitNotImplementedError,
    GeneralWarning
} from './exceptions.js';

import {
    equal_types,
    pretty_args,
    pretty_type,
} from './ast_util.js';

import compiler from './crystal-ast.cjs';

const _scriptdir = path.dirname(fileURLToPath(import.meta.url));
const _imports_dir = path.resolve(path.join(_scriptdir, '..', 'imports'));

export function func_signature_as_text(func_def) {
    var vis = func_def.vis;
    if (vis == 'read-only') vis='public readonly';
    var name = func_def.name;
    var args = pretty_args(func_def.args, true);
    var returns = pretty_type(func_def, true);
    return `${vis} function ${name}(${args}) => ${returns}`;
}

export function generate_import_file(ast, contract_name, output_cb) {

    var trait_impl_output = [];
    var extern_output = [];
    var trait_defs_output = [];

    // if a contract implements a trait, in order to 'use trait' in
    // another contract, the function definitions must be
    // available. we'll copy the trait definition to the implementing
    // contract's import file here. the definition doesn't have any
    // meaning in the runtime context, it only allows for type checks
    // during compilation
    ast.forEach(definition => {
        if (definition.op == 'impl_trait' &&
            equal_types(definition.expr, { type: 'trait_def' }))
        {
            var trait_def = definition.expr.decl;
            trait_impl_output.push(`    implements trait ${trait_def.contract_id.val}.${trait_def.id},\n`);
        }
    });
    
    ast.forEach(definition => {
        
        if (definition.op == 'func_def' && (
            definition.vis=='public' || definition.vis=='read-only'))
        {
            if (definition.trait_def)
                extern_output.push(`    // member of trait ${definition.trait_def.contract_id.val}.${definition.trait_def.id}\n`);
            extern_output.push(`    ${func_signature_as_text(definition)},\n`);
        }
        
        else if (definition.op == 'trait_def') {
            trait_defs_output.push(`    trait ${definition.id} {\n`);
            definition.traits.forEach(trait_item => {
                trait_defs_output.push(`        ${func_signature_as_text(trait_item)},\n`);
            });
            trait_defs_output.push(`    },\n`);
        }
    });


    if (trait_impl_output.length > 0 ||
        extern_output.length > 0 ||
        trait_defs_output.length >0)
    {
        output_cb(`//\n`);
        output_cb(`// this is a generated file - do not edit\n`);
        output_cb(`//\n`);
        output_cb(`// Contract: ${contract_name.substr(0,1)=='.' ? '' : '.'}${contract_name}\n`);
        output_cb(`\n`);
        output_cb(`declare extern {\n`);
        
        trait_impl_output.forEach(line => output_cb(line));
        if (trait_impl_output.length>0) output_cb(`\n`);
        
        extern_output.forEach(line => output_cb(line));
        if (extern_output.length>0) output_cb(`\n`);
        
        trait_defs_output.forEach(line => output_cb(line));
        output_cb(`};\n`);
    }
}


export function compile_import_file(opts, fn, contract_id, as_id) {
    try {
        var txt = fs.readFileSync(fn).toString();
    } catch(e) {
        throw new ImportFileError(opts.ctx_node, `${e}`);
    }

    // if the contract_id was not given with the import statement, try
    // to get it from the import file's .json file
    var import_json_fn = fn + '.json';
    var contract_id_from_json = false;
    if (!contract_id && fs.existsSync(import_json_fn)) {
        try {
            var json =JSON.parse(fs.readFileSync(import_json_fn).toString());
            var lookup = json.contract_id || json["contract-id"];
            if (lookup) {
                var val = lookup[opts.compile.network] ||
                    lookup["default"];
                if (val) {
                    contract_id = { op:'lit', type:'string', val };
                    contract_id_from_json = true;
                }
                else {
                    var e = new GeneralWarning(`a contract id for stacks network '${opts.compile.network}' was not found and there was no default`);
                    e.set_file(import_json_fn);
                    opts.compile.warning(e);
                }
            }
        } catch(e) {
            throw new ImportFileError(opts.ctx_node, `could not read '${import_json_fn}': ${e}`);
        }
    }


    // give a warning if the contact name in the import file
    // differs from the one specified by the import statement
    
    var re = /\n\/\/ Contract: (.*)/;
    var match = txt.match(re);
    if (match && contract_id && !contract_id_from_json) {
        var contract_parts = contract_id.val.split('.');
        var name = contract_parts[contract_parts.length -1];
        var cmp_name = match[1];
        if (cmp_name.substr(0,1)=='.') cmp_name=cmp_name.substr(1);
        
        if (cmp_name != name && cmp_name != contract_id.val) {
            opts.compile.warning(opts.ctx_node, `the import statement's contract name '${contract_id.val}' is different than the import file's '${match[1]}'. It's essential that the contract name '${contract_id.val}' match the name of the actual contract deployed on Stacks or runtime failures will occur.`);
        }
    }
    
    var ast = new compiler.Parser().parse(txt);
    ast.forEach(def => {
        if (def.op == 'declare_extern') {
            if (contract_id && def.contract_id) {
                var e = new GeneralWarning(def, `overriding the import file's contract id with the import statement's`);
                e.set_file(fn);
                opts.compile.warning(e);
            }
            def.id = as_id;
            def.contract_id = contract_id;
        }
    });
    return ast;
}


export function merge_imports(ast, compile) {
    // compile: compile options

    // compile all imports and add them to the ast
    var import_nodes = [];
    ast.forEach((definition, idx) => {
        if (definition.op == 'import') {
            var rel_base = path.dirname(compile.src);
            var is_absolute = path.isAbsolute(definition.file);
            var is_relative = !is_absolute && definition.file.substr(0,1)=='.';
            var import_path = null;
            if (is_absolute || is_relative) {
                import_path = is_absolute ?
                    definition.file : path.join(rel_base, definition.file);
            }
            else {
                import_path =path.resolve(
                    path.join(_imports_dir, definition.file +'.import')
                );
                if (import_path.substr(0, _imports_dir.length) != _imports_dir)
                {
                    // make sure the final path is within the
                    // 'imports' directory
                    throw new ImportFileError(opts.ctx_node, `not a valid import location '${definition.file}'`);
                }
            }
            

            try {
                var import_ast = compile_import_file(
                    { ctx_node: definition,
                      compile },
                    import_path,
                    definition.contract_id,
                    definition.as_id,
                );

                import_nodes.push({
                    splice_at: idx,
                    import_path: import_path,
                    ast: import_ast
                });
            } catch(e) {
                if (e instanceof ParserError) throw e;
                throw new ImportFileError(definition, `Unable to import '${import_path}': ${e}`);
            }
        }
    });

    // add all import nodes to the ast, replacing the 'import'
    import_nodes.reverse();
    import_nodes.forEach(imp => {
        // record the import file path for error messages
        imp.ast.forEach(node => {
            if (node.op == 'declare_extern') {
                node.import_path = imp.import_path;
            }
            else {
                var e = new ImportFileError(node, `'${node.op}' is not a valid type for import`);
                e.set_file(imp.import_path);
                throw e;
            }
        });
        ast.splice(imp.splice_at, 1, ...imp.ast);
    });
    
}
