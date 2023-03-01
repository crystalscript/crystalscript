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

/*
 *  jison grammer to generate an ast from a Crystal Script
 */

%{
    function prependChild(node, child){
        node.unshift(child);
        return node;
    }
    function getLine(v) {
        if (typeof v == 'number') return v;
        return v.first_line;
    }
    function parseError(yy, opts) {
        var expected = opts.expected ? `Expecting ${opts.expected}` : '';
        yy.parser.parseError(`Parse error on line ${opts.line}:\n${yy.lexer.showPosition()}\n${expected}`, {});
    }
    function expectText(yy, lineno, desired, actual) {
        if (desired == actual) return;
        parseError(yy, {
             line: lineno,
             expected:`'${desired}' not '${actual}'`
        });
    }
    function hexStringToBuffer(str) {
        if (str.length % 2 == 1) str='0'+str;
        return Buffer.from(str,'hex');
    }

%}

%left COMMA
%right ASSIGNMENT INSERT_ASSIGNMENT
%right EXPR_IF
%left OR
%left AND
%left EQUALS NOTEQUALS
%left GTE LTE GT LT
%left PLUS MINUS
%left MULTIPLY DIVIDE MOD POW XOR
%left ARROW
%right NOT DELETE UNWRAP
%left DOT LBRACKET LPAREN

%start prog

%%

prog
    : definitions ENDOFFILE
      {{ return $1; }}
    | ENDOFFILE
      {{ return []; }}
    ;

definitions
    : definition definitions
      {{ $$ = prependChild($2,$1); }}
    | definition
      {{ $$ = [$1]; }}
    ;

definition
    : visibility func_def
      {{ $$ = $2; $$.vis = $1; }}
    | const
    | persist
    | define_trait
    | implement_trait
    | declare_extern
    | import_file
    ;

persist
    : PERSIST ID AS persist_map_def SEMICOLON
      {{ $$=$4; Object.assign($$, { op:'persist', access:'datamap', id:$2, line:getLine(this._$) }); }}
    | PERSIST ID AS persist_var_def SEMICOLON
      {{ $$=$4; Object.assign($$, { op:'persist', access:'datavar', id:$2, line:getLine(this._$) }); }}
    | PERSIST ID AS persist_fungible_token_def SEMICOLON
      {{ $$=$4; Object.assign($$, { op:'persist', access:'ft', protect:'const', id:$2, line:getLine(this._$) }); }}
    | PERSIST ID AS persist_nonfungible_token_def SEMICOLON
      {{ $$=$4; Object.assign($$, { op:'persist', access:'nft', protect:'const', id:$2, line:getLine(this._$) }); }}
    ;

persist_map_def
    : type ARROW type
      {{ $$ = { type:'datamap', keytype:$1, valtype:$3, line:getLine(this._$) }; }}
    ;

persist_var_def
    : type txt_with ID ASSIGNMENT expr
      {{ expectText(yy, yylineno, 'initial-value', $3); $$ = {  initial_val:$5, line:getLine(this._$) }; Object.assign($$, $1); }}
    ;

persist_fungible_token_def
    : FUNGIBLE_TOKEN txt_with ID
       {{ expectText(yy, yylineno, 'unlimited-supply', $3); $$ = {  type:'ft', total_supply:null, line:getLine(this._$) }; }}
    | FUNGIBLE_TOKEN txt_with ID ASSIGNMENT expr
       {{ expectText(yy, yylineno, 'total-supply', $3); $$ = {  type:'ft', total_supply:$5, line:getLine(this._$) }; }}
    ;

persist_nonfungible_token_def
    : NONFUNGIBLE_TOKEN txt_identified txt_by asset_id_type
       {{ $$ = { type:'nft', tokenidtype: $4, line:getLine(this._$) }; }}
    ;

asset_id_type
    : INT
      {{ $$ = { type:'int', line:getLine(this._$) }; }}
    | UINT
      {{ $$ = { type:'uint', line:getLine(this._$) }; }}
    | BUFF LBRACKET int_literal RBRACKET
      {{ $$ = { type:'buff', line:getLine(this._$), size:$3.val }; }}
    | STRING LBRACKET int_literal RBRACKET
      {{ $$ = { type:'string', line:getLine(this._$), size:$3.val }; if ($3.val < 0) parserError(yy, {line:yylineno, expected:'positive integer for index'}); }}
    | STRING-ASCII LBRACKET int_literal RBRACKET
      {{ $$ = { type:'string-ascii', line:getLine(this._$), size:$3.val }; if ($3.val < 0) parserError(yy, {line:yylineno, expected:'positive integer for index'}); }}
    ;

txt_with
    : ID
      {{ expectText(yy, yylineno, 'with', $1); }}
    ;
txt_identified
    : ID
      {{ expectText(yy, yylineno, 'identified', $1); }}
    ;
txt_by
    : ID
      {{ expectText(yy, yylineno, 'by', $1); }}
    ;
txt_from
    : ID
      {{ expectText(yy, yylineno, 'from', $1); }}
    ;

define_trait
    : DEFINE TRAIT ID LBRACE trait_items RBRACE SEMICOLON
      {{ $$= { op:'trait_def', id:$3, traits:$5, line:getLine(this._$) }; }}
    ;

trait_items
    : trait_item COMMA trait_items
      {{ $$=prependChild($3, $1); }}
    | trait_item
      {{ $$=[$1]; }}
    |
      {{ $$=[]; }}
    ;

trait_item
    : public_visibility FUNCTION ID LPAREN type_list RPAREN ARROW type
      {{ $$={op:'extern_func_def', vis:$1, name:$3, args:$5 }; Object.assign($$, $8); }}
    ;

implement_trait
    : IMPLEMENT TRAIT expr SEMICOLON
      {{ $$={ op:'impl_trait', expr:$3, line:getLine(this._$) }; }}
    ;

declare_extern
    : DECLARE EXTERN contract_id LBRACE extern_contract_defs RBRACE SEMICOLON
      {{ $$={ op:'declare_extern', type:'extern_decl', id:null, protect:'const', access:'contract', contract_id:$3, defs:$5, line:getLine(this._$) }; }}
    | DECLARE EXTERN contract_id AS ID LBRACE extern_contract_defs RBRACE SEMICOLON
      {{ $$={ op:'declare_extern', type:'extern_decl', id:$5, protect:'const', access:'contract', contract_id:$3, defs:$7, line:getLine(this._$) }; }}
    | DECLARE EXTERN LBRACE extern_contract_defs RBRACE SEMICOLON
      {{ $$={ op:'declare_extern', type:'extern_decl', id:null, protect:'const', access:'contract', contract_id:null, defs:$4, line:getLine(this._$) }; }}
    ;

extern_contract_defs
    : extern_contract_def COMMA extern_contract_defs
      {{ $$=prependChild($3, $1); }}
    | extern_contract_def
      {{ $$=[$1]; }}
    |
      {{ $$=[]; }}
    ;

extern_contract_def
    : public_visibility FUNCTION ID LPAREN type_list RPAREN ARROW response_type
      {{ $$=Object.assign({ op:'extern_func_def', name:$3, vis:$1, args:$5, contract_id:null, line:getLine(this._$) }, $8); }}
    | TRAIT ID LBRACE trait_items RBRACE
      {{ $$={ op:'extern_trait_def', id:$2, traits:$4, contract_id:null }; }}
    | IMPLEMENTS TRAIT contract_id
      {{ $$={ op:'extern_trait_def_impl', impl_contract_id:$3, contract_id:null }; }}
    ;

public_visibility
    : PUBLIC
    | PUBLIC READONLY
      {{ $$='read-only' }}
    ;

import_file
    : IMPORT contract_id txt_from string_literal AS ID SEMICOLON
      {{ $$={ op:'import', file:$4.val, contract_id:$2, as_id:$6, line:getLine(this._$) }; }}
    ;


consts
    : const consts
      {{ $$=prependChild($2, $1); }}
    |
      {{ $$=[]; }}
    ;
    
const
    : CONST ID ASSIGNMENT expr SEMICOLON
      {{ $$ = { op:'vardecl', id:$2, protect:'const', type:null, line:getLine(this._$), expr:$4 }; }}
    ;

consts_then_stmts
    : consts stmts
      {{ $$ = $1; $$.push.apply($$, $2); }}
    ;
    
stmts
    : stmt stmts
      {{ $$ = prependChild($2, $1); }}
    | stmt
      {{ $$ = [ $1 ]; }}
    | expr SEMICOLON stmts
      {{ $$ = prependChild($3, $1); }}
    | expr SEMICOLON
      {{ $$ = [ $1 ]; }}
    ;

stmt
    // if-elseif+-else*
    : IF LPAREN expr RPAREN LBRACE consts_then_stmts RBRACE elseif else
      {{ $$ = { op:'if', line:getLine(this._$), expr:$3, body:$6, elsif:$8, else_body: $9 }; }}
    // if-else*
    | IF LPAREN expr RPAREN LBRACE consts_then_stmts RBRACE else
      {{ $$ = { op:'if', line:getLine(this._$), expr:$3, body:$6, else_body: $8 }; }}
    | func_def
      {{ $$ = $1; $$.vis='private'; }}
    | RETURN expr SEMICOLON
      {{ $$ = { op:'return', type:null, line:getLine(this._$), expr:$2 }; }}
    ;

elseif
    : elseif ELSE IF LPAREN expr RPAREN LBRACE consts_then_stmts RBRACE
      {{ $$ = $1; $$.push({ expr:$5, body:$8}); }}
    | ELSE IF LPAREN expr RPAREN LBRACE consts_then_stmts RBRACE
      {{ $$ = [{ expr:$4, body:$7 }]; }}
    ;
    
else
    : ELSE LBRACE consts_then_stmts RBRACE
      {{ $$ = $3; }}
    |
      {{ $$ = null; }}
    ;

expr
    : literal
    | ID
      {{ $$={ op:'id', type:null, line:getLine(this._$), id:$1 }; }}
    | expr LBRACKET expr RBRACKET
      {{ $$ = { op:'[]', type:null, line:getLine(this._$), expr:$1, bracket:$3 }; }}
    | expr DOT ID
      {{ $$ = { op:'.', type:null, line:getLine(this._$), bracket:{ op:'lit',type:'string', val:$3 }, expr:$1 }; }}
    | DOT ID
      {{ $$ = { op:'.', type:null, line:getLine(this._$), bracket:{ op:'lit',type:'string', val:$2 }, expr:null }; }}
    | LPAREN expr RPAREN
      {{ $$ = $2; }}
    | MINUS expr
      {{ $$ = { op:'sign-', type:null, line:getLine(this._$), a:$2 }; }}
    | PLUS expr
      {{ $$ = { op:'sign+', type:null, line:getLine(this._$), a:$2 }; }}
    | expr PLUS expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | expr MINUS expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | expr MULTIPLY expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | expr DIVIDE expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | expr MOD expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr POW expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr XOR expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr GTE expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr LTE expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr GT expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr LT expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr EQUALS expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr NOTEQUALS expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), a:$1, b:$3 }; }}
    | expr AND expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | expr OR expr
      {{ $$ = { op:$2, type:null, line:getLine(this._$), multi:[$1, $3] }; }}
    | NOT expr
      {{ $$ = { op:$1, type:null, line:getLine(this._$), a:$2 }; }}
    | UNWRAP expr
      {{ $$ = { op:$1, type:null, line:getLine(this._$), a:$2 }; }}
    | expr EXPR_IF expr COLON expr
      {{ $$ = { op:'expr_if', type:null, line:getLine(this._$), expr:$1, a:$3, b:$5 }; }}
    | func_call
      {{ $$ = $1; }}
    // we don't want generic anon functions, so restricting to foreach
    | FOREACH LPAREN expr COMMA anon_func_def RPAREN
      {{ $$ = { op:'foreach', type:null, itemtype:null, a:$3, b:$5, line:getLine(this._$) }; $5.genesis_op = 'foreach'; }}
    | FOREACH LPAREN expr COMMA ID RPAREN
      {{ $$ = { op:'foreach', type:null, itemtype:null, a:$3, b:{op:'id',id:$5,type:null}, line:getLine(this._$) }; }}
    | PRINCIPAL LPAREN expr RPAREN
      {{ $$ = { op:'principal', type:null, line:getLine(this._$), a:$3 }; }}
    | OPTIONAL LPAREN expr RPAREN
      {{ $$ = { op:'optional', type:null, itemtype:null, line:getLine(this._$), a:$3 }; }}
    | expr ASSIGNMENT expr
      {{ $$ = { op:'=', lval:$1, rval:$3, type:null, line:getLine(this._$) }; }}
    | expr INSERT_ASSIGNMENT expr
      {{ $$ = { op:'?=', lval:$1, rval:$3, type:null, line:getLine(this._$) }; }}
    | DELETE expr
      {{ $$ = { op:'delete', lval:$2, type:null, line:getLine(this._$) }; }}
    | COUNTOF LPAREN ID RPAREN
      {{ $$ = { op:'countof', id:{op:'id', id:$3, type:null}, line:getLine(this._$) }; }}
    ;


visibility
    : PUBLIC READONLY
      {{ $$ = 'read-only'; }}
    | PUBLIC
      {{ $$ = 'public'; }}
    | PRIVATE
      {{ $$ = 'private'; }}
    |
      {{ $$ = 'private'; }}
    ;

func_def
    : FUNCTION ID LPAREN func_args_def RPAREN LBRACE consts_then_stmts RBRACE
      {{ $$ = { op:'func_def', vis:null, name:$2, type:null, line:getLine(this._$), args:$4, body:$7, }; }}
    ;
    
func_args_def
    : ID type COMMA func_args_def
      {{ $$ = prependChild($4, Object.assign({name:$1, protect:'const'}, $2)); }}
    | ID type
      {{ $$ = [Object.assign({name:$1, protect:'const'}, $2)]; }}
    |
      {{ $$ = []; }}
    ;    

func_call
    : INT LPAREN expr RPAREN
      {{ $$ = { op:'int', type:null, line:getLine(this._$), a:$3 }; }}
    | UINT LPAREN expr RPAREN
      {{ $$ = { op:'uint', type:null, line:getLine(this._$), a:$3 }; }}
    | expr LPAREN func_args RPAREN
      {{ $$ = { op:'func_call', name:$1, type:null, line:getLine(this._$), args:$3 }; }}
    ;

func_args
    : operator COMMA func_args
      {{ $$ = prependChild($3, { op:'id', id:$1} ); }}
    | expr COMMA func_args
      {{ $$ = prependChild($3, $1); }}
    | operator
      {{ $$ = [{ op:'id', id:$1 }]; }}
    | expr
      {{ $$ = [$1]; }}
    |
      {{ $$ = []; }}
    ;    

operator
    // these should match the operatorAbi list in ast_syscall.js
    // they're valid arguments to syscalls 'map' and 'fold'
    : PLUS | MINUS | MULTIPLY | DIVIDE | MOD | POW | XOR | GTE | LTE | GT | LE | EQUALS | AND | OR | NOT
    ;

anon_func_def
   : LPAREN anon_func_args_def RPAREN ARROW LBRACE consts_then_stmts RBRACE
     {{ $$= { op:'anon_func_def', vis:'private', args:$2, body:$6, type:null, line:getLine(this._$) }; }}
   ;
   
anon_func_args_def
   // list of id's that are dynamically typed based on context (eg. foreach)
   : ID COMMA anon_func_args_def
     {{ $$ = prependChild($3, { name:$1, protect:'const' }); }}
   | ID
     {{ $$ = [{ name:$1, protect:'const' }]; }}
   |
     {{ $$ = []; }}
   ;

type
    : OPTIONAL actual_type
      {{ $$ = { type:'optional', itemtype:$2, line:getLine(this._$) }; }}
    | trait_type
    | actual_type
    ;

type_list
    : type COMMA type_list
      {{ $$ = prependChild($3, $1); }}
    | type
      {{ $$ = [ $1 ]; }}
    |
      {{ $$ = []; }}
    ;

actual_type
    : LIST LT type GT LBRACKET int_literal RBRACKET
      {{ $$ = { type:'list', line:getLine(this._$), itemtype:$3, size:$6.val }; }}
    | INT
      {{ $$ = { type:'int', line:getLine(this._$) }; }}
    | UINT
      {{ $$ = { type:'uint', line:getLine(this._$) }; }}
    | BUFF LBRACKET int_literal RBRACKET
      {{ $$ = { type:'buff', line:getLine(this._$), size:$3.val }; }}
    | BOOL
      {{ $$ = { type:'bool', line:getLine(this._$) }; }}
    | STRING LBRACKET int_literal RBRACKET
      {{ $$ = { type:'string', line:getLine(this._$), size:$3.val }; if ($3.val < 0) throw new Error('index cannot be negative'); }}
    | STRING-ASCII LBRACKET int_literal RBRACKET
      {{ $$ = { type:'string-ascii', line:getLine(this._$), size:$3.val }; if ($3.val < 0) throw new Error('index cannot be negative'); }}
    | PRINCIPAL
      {{ $$ = { type:'principal', line:getLine(this._$) }; }}
    | response_type
    | LBRACE mapkeysdef RBRACE
      {{ $$ = { type:'map', line:getLine(this._$), maptype:$2 }; }}
    ;

trait_type
    : TRAIT LT trait_itemtype GT
      {{ $$ = { type:'trait', itemtype:$3, line:getLine(this._$) }; }}
    ;

trait_itemtype
    : ID
      {{ $$={ op:'id', type:null, line:getLine(this._$), id:$1 }; }}
    | PRINCIPAL LPAREN expr RPAREN
      {{ $$ = { op:'principal', type:null, line:getLine(this._$), a:$3 }; }}
    | trait_itemtype LBRACKET expr RBRACKET
      {{ $$ = { op:'[]', type:null, line:getLine(this._$), expr:$1, bracket:$3 }; }}
    | trait_itemtype DOT ID
      {{ $$ = { op:'.', type:null, line:getLine(this._$), bracket:{ op:'lit',type:'string', val:$3 }, expr:$1 }; }}
    | DOT ID
      {{ $$ = { op:'.', type:null, line:getLine(this._$), bracket:{ op:'lit',type:'string', val:$2 }, expr:null }; }}
    ;
    
response_type
    : RESPONSE LT type COMMA type GT
      {{ $$ = { type:'response', line:getLine(this._$), oktype:$3, errtype:$5 }; }}
    | RESPONSE LT type COMMA GT
      {{ $$ = { type:'response', line:getLine(this._$), oktype:$3 }; }}
    | RESPONSE LT COMMA type GT
      {{ $$ = { type:'response', line:getLine(this._$),  errtype:$4 }; }}
    ;


mapkeysdef
    : ID COLON type COMMA mapkeysdef
      // using Object.assign will preserve the key order
      {{ $$ = {}; $$[$1] = $3; Object.assign($$, $5); }}
    | ID COLON type
      {{ $$ = {}; $$[$1] = $3; }}
    ;

literal
    : CONTRACT-CALLER
      {{ $$ = {op:'lit', type:'principal', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | TX-SENDER
      {{ $$ = {op:'lit', type:'principal', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | BLOCK-HEIGHT
      {{ $$ = {op:'lit', type:'uint', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | BURN-BLOCK-HEIGHT
      {{ $$ = {op:'lit', type:'uint', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | STX-LIQUID-SUPPLY
      {{ $$ = {op:'lit', type:'uint', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | IS-IN-REGTEST
      {{ $$ = {op:'lit', type:'bool', line:getLine(this._$), subtype:'keyword', val:yytext}; }}
    | NONE
      {{ $$ = {op:'lit', type:'none', line:getLine(this._$), subtype:'keyword', val:yytext }; }}
    | STX_ADDRESS
      {{ $$={ op:'lit', type:'principal', line:getLine(this._$), val:$1 }; }}
    | string_literal
    | int_literal
    | bool_literal
    | buff_literal
    | list_literal
    | map_literal
    ;

string_literal
    : QUOTED-STRING
      {{ $$ = {op:'lit', type:'string', line:getLine(this._$), size:BigInt(yytext.length-2), val:yytext.substring(1,yytext.length-1) }; }}
    ;

int_literal
    : INT_LITERAL
      {{ $$ = { op:'lit', type:'int', line:getLine(this._$), val:BigInt(yytext)}; }}
    | UINT_LITERAL
      {{ $$ = { op:'lit', type:'uint', line:getLine(this._$), val:BigInt(yytext.substring(1)) }; }}
    ;

bool_literal
    : TRUE
      {{ $$ = { op:'lit', type:'bool', line:getLine(this._$), val:true }; }}
    | FALSE
      {{ $$ = { op:'lit', type:'bool', line:getLine(this._$), val:false }; }}
    ;

buff_literal
    : HEX_NUMBER
      {{ var b=hexStringToBuffer(yytext.substr(2)); $$ = { op:'lit', type:'buff', line:getLine(this._$), size:BigInt(b.length), val:b }; }}
    ;

map_literal
    : LBRACE map_literal_vals RBRACE
      {{ $$ = {op:'lit', type:'map', maptype:null, line:getLine(this._$), val:$2}; }}
    ;

map_literal_vals
    : ID COLON expr COMMA map_literal_vals
      // using Object.assign will preserve the key order
      {{ $$ = {}; $$[$1] = $3; Object.assign($$, $5); }}
    | ID COLON expr
      {{ $$ = {}; $$[$1] = $3; }}
    ;

list_literal
    : LBRACKET list_literal_vals RBRACKET
      {{ $$ = { op:'lit', type:'list', itemtype:null, line:getLine(this._$), size:BigInt($2.length), val:$2 }; }}
    ;

list_literal_vals
    : expr COMMA list_literal_vals
      {{ $$ = prependChild($3, $1); }}
    | expr
      {{ $$ = [$1] }}
    |
      {{ $$ = []; }}
    ;

contract_id
    : STX_ADDRESS contract_id_relative
      {{ $$=$2; $$.val = $1 + $$.val; }}
    | contract_id_relative
    ;

contract_id_relative
    : DOT ID contract_id_relative
      {{ $$=$3; $$.val = '.' + $2 + $$.val; }}
    | DOT ID
      {{ $$ = { op:'lit', type:'principal', line:getLine(this._$), val:'.'+$2 }; }}
    ;
    
