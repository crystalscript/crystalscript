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

%options flex

digit                       [0-9]
hex_digit                   [0-9A-Fa-f]
id                          [a-zA-Z][a-zA-Z0-9-_]*[!?]{0,1}
quoted_string               \"(?:[^"\\]|\\.)*\"
stx_address                 [S][A-Z0-9]{39,40}

%%

"//".*                      /* ignore comment */
"import"                    return 'IMPORT';
"const"                     return 'CONST';
"private"                   return 'PRIVATE';
"public"                    return 'PUBLIC';
"readonly"                  return 'READONLY';
"function"                  return 'FUNCTION';
"persist"                   return 'PERSIST';
"declare"                   return 'DECLARE';
"extern"                    return 'EXTERN';
"define"                    return 'DEFINE';
"use"                       return 'USE';
"as"                        return 'AS';
"trait"                     return 'TRAIT';
"implement"                 return 'IMPLEMENT';
"implements"                return 'IMPLEMENTS';
"fungible-token"            return 'FUNGIBLE_TOKEN';
"nonfungible-token"         return 'NONFUNGIBLE_TOKEN';

"if"                        return 'IF';
"else"                      return 'ELSE';
"return"                    return 'RETURN';
"foreach"                   return 'FOREACH';
"_countof"                  return 'COUNTOF';
"_typeof"                   return 'TYPEOF';

// types
"list"                      return 'LIST';
"int"                       return 'INT';
"uint"                      return 'UINT';
"bool"                      return 'BOOL';
"string-ascii"              return 'STRING-ASCII';
"string-utf8"               return 'STRING';
"string"                    return 'STRING';
"principal"                 return 'PRINCIPAL';
"response"                  return 'RESPONSE';
"buff"                      return 'BUFF';
"optional"                  return 'OPTIONAL';

// operators
"delete"                    return 'DELETE';

// literals
"true"                      return 'TRUE';
"false"                     return 'FALSE';
"none"                      return 'NONE';
"contract-caller"           return 'CONTRACT-CALLER';
"tx-sender"                 return 'TX-SENDER';
"block-height"              return 'BLOCK-HEIGHT';
"burn-block-height"         return 'BURN-BLOCK-HEIGHT';
"stx-liquid-supply"         return 'STX-LIQUID-SUPPLY';
"is-in-regtest"             return 'IS-IN-REGTEST';
{digit}+                    return 'INT_LITERAL';
"u"{digit}+                 return 'UINT_LITERAL';
"0x"{hex_digit}*            return 'HEX_NUMBER';
{stx_address}               return 'STX_ADDRESS';
{id}                        return 'ID';
{quoted_string}             return 'QUOTED-STRING';

// operators
"+"                         return 'PLUS';
"-"                         return 'MINUS';
"*"                         return 'MULTIPLY';
"/"                         return 'DIVIDE';
"%"                         return 'MOD';
"**"                        return 'POW';
"^"                         return 'BIT_XOR';
"~"                         return 'BIT_NOT';
"&"                         return 'BIT_AND';
"|"                         return 'BIT_OR';
'<<'                        return 'BIT_SHIFT_LEFT';
'>>'                        return 'BIT_SHIFT_RIGHT';
">="                        return 'GTE';
"<="                        return 'LTE';
">"                         return 'GT';
"<"                         return 'LT';
"=="                        return 'EQUALS';
"!="                        return 'NOTEQUALS';
"?="                        return 'INSERT_ASSIGNMENT';
"="                         return 'ASSIGNMENT';

"&&"                        return 'AND';
"||"                        return 'OR';
"!"                         return 'NOT';
"#"                         return 'UNWRAP';

"."                         return 'DOT';
":"                         return 'COLON';
";"                         return 'SEMICOLON';
","                         return 'COMMA';
"("                         return 'LPAREN';
")"                         return 'RPAREN';
"{"                         return 'LBRACE';
"}"                         return 'RBRACE';
"["                         return 'LBRACKET';
"]"                         return 'RBRACKET';
"?"                         return 'EXPR_IF';
"=>"                        return 'ARROW';

\s+                         /* skip whitespace */
.                           return 'UNKNOWN';
<<EOF>>                     return 'ENDOFFILE';
