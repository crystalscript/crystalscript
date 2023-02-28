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

/* extract the comments from a Crystal Script */

/* lexical grammar */
%lex
%options flex

%%
"//".*"//".*              /* ignore commented comment */
"//"\s*";;".*             return 'COMMENT';
\s+                       /* ignore */
.                         /* ignore */
<<EOF>>                   return 'EOF';

/lex


%% /* language grammar */

start
    : comments EOF
      {{ return $1; }}
    | EOF
      {{ return []; }}
    ;

comments
    : comments COMMENT
      {{ $$ = $1; $$.push({ c:$2.substr(2).trimLeft(), line:yylineno+1 }); }}
    | COMMENT
      {{ $$ = [ { c:$1.substr(2).trimLeft(), line:yylineno+1 } ]; }}
    ;

