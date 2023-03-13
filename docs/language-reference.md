# Crystal Script Language Reference

Contents:

1. [Contract components](#contract-components)
    - [Constants](#constants)
    - [Data persisted on the blockchain](#data-persisted-on-the-blockchain)
      - [Simple variables](#simple-variables)
      - [Data maps](#data-maps)
      - [Fungible tokens](#fungible-tokens)
      - [Non-fungible tokens](#non-fungible-tokens)
    - [Functions](#functions)
    - [Imports](#imports)
      - [Import statement](#import-statement)
      - [Import for a specific Stacks network](#import-for-a-specific-stacks-network)
      - [Calling functions of other contracts](#calling-functions-of-other-contracts)
      - [Well known contracts](#well-known-contracts)
    - [Traits](#traits)
      - [Define a trait](#define-a-trait)
      - [Implement a trait](#implement-a-trait)
      - [Use a trait](#use-a-trait)
      - [Execute a function that requires a trait as an argument](#execute-a-function-that-requires-a-trait-as-an-argument)

1. [Types](#types)
    - [Type properties](#type-properties)
    - [Special literals](#special-literals)
    - [Type conversion functions](#type-conversion-functions)
    - [Working with responses](#working-with-responses)
    - [Working with optionals](#working-with-optionals)
    - [Literal coersion](#literal-coersion)

1. [Expressions](#expressions)
    - [Operators](#operators)
    - [Keywords](#keywords)

1. [Statements](#statements)
    - [const](#const)
    - [if / else if / else](#if--else-if--else)
    - [Inner functions](#inner-functions)
    - [return](#return)

1. [System calls](#system-calls)
    - [foreach function](#foreach-function)

1. [Comments](#comments)
    - [Include comments in Clarity code](#include-comments-in-clarity-code)

1. [Embedded tests](#embedded-tests)




## Contract components

To create a smart contract with crystalscript, define one of more of the following in your source code file:

[*constants*](#constants) - global constants

[*persisted data*](#persist) - contract data on the blockchain

[*private, public and read-only functions*](#functions)

[*import statements*](#imports) - accessing other contract's functions and traits

[*traits*](#traits) - function definitions that are declared, implemented and referenced



## Constants

At the top level of the contract, constants are equivalent to "define-constant" in Clarity, but declared as follows:
```
const NAME = EXPRESSION;
```
For example:
```
const ERR_INSUFFICIENT_FUNDS = 5;
```

Constants may also appear in scopes, such as function and if/else bodies. For example:
```
function xyx() { const factor = u5; }
```

Scoped constants must appear at the top of the scope before any other statements. However, constants may reference inner functions declared after the const as well as global functions.

Scoped constants are converted to a Clarity "let" function.



## Data persisted on the blockchain

### Simple variables

Persisted variables hold a single value that may be read and updated by the contract. The value is "global" - not tied the lifetime of the called contract function.

Define a persistent variable using the syntax:
```
persist NAME as TYPE with initial-value = EXPRESSION;
```

This statement will compile to the Clarity function "define-data-var".

For example:
```
persist costFactor as uint with initial-value=5;
```

To read the variable, simply use it by name. Eg.
```
function cost(n uint) {
    return n * costFactor;
}
```

To change the variable, simply assign a new value and commit the result with ok():
```
public function advanceCost(amt uint) {
    const oldVal = costFactor;
    costFactor = costFactor + amt;
    return ok(oldVal);
}
```


### Data maps

Persistent maps (data maps) are like hash tables, dictionaries, associatve arrays, etc. The hash or key to the data map can be any type, including a map. Data map values can also be any type. Data maps are "global" - not tied the lifetime of the called contract function.

Define a data map using the syntax:
```
persist NAME as TYPE => TYPE;
```

This statement will compile to the Clarity function "define-map".

For example:
```
persist id2user as { id: int } => { name: string[10], balance: uint };
```

These variables are readable just by using their id, eg:

```
const username = id2user[{ id: 1 }].name;
```

And settable:

```
id2user[{ id: 1 }] = { name:"fred", balance:u500 };
```

Individual keys in the above example are not changeable. ie.
```
id2user[{ id: 1 }].name = "fred sr.";   // NOT ALLOWED
```

...but can be accomplished with the `merge` function:
```
id2user[{ id: 1 }] = merge(id2user[{ id: 1 }], { name:"fred sr." });
```

Data map entries can be removed with `delete`:
```
delete id2user[{ id:1 }];
```

Use the `?=` assignment operator to update entries only if they don't already exist. This operator compiles to Clarity's "map-insert" function:
```
id2user[{ id:1 }] ?= { name:"fred", balance:u0 };
```


### Fungible tokens

Contracts declare fungible token variables to construct new fungible "currencies".

The data associated with fungible tokens is "global" - not tied the lifetime of the called contract function.

To create a fungible token with a limited supply of tokens, use this syntax:
```
persist NAME as fungible-token with total-supply=AMOUNT;
```

for fungible tokens with unlimited supply, use:
```
persist NAME as fungible-token with unlimited-supply;
```

For example, an 'updown' token with 1 million maximum supply:
```
persist updown as fungible-token with total-supply=u1000000;
```

To mint, burn, transfer, etc these tokens, see the [system calls](#system-calls) that start with "ft-", or use the corresponding properties of the fungible token:

```
persist updown as fungible-token with total-supply=u1000000;

const alice = SP2JPBTPVXN7V5N0SH7ZP95GM1GTFVT8SKVAW3R77;
const bob = SP3WT3PT3NA5SWW82DZ8ZFK8RN412AD3KR5Q7Q3K4;

public function mint-and-give() {
    updown.mint?(u100, alice);
    updown.getSupply();
    updown.transfer?(u15, alice, bob);
    updown.burn?(u10, alice);
    return ok( updown.getBalance(alice) );  // 75
}
```


### Non-fungible tokens

Contracts declare non-fungible token variables to construct new non-fungible tokens.

The data associated with non-fungible tokens is "global" - not tied the lifetime of the called contract function.

To create a non-fungible token, use this syntax:
```
persist NAME as nonfungible-token identified by TYPE;
```

For example:
```
persist nifty as nonfungible-token identified by string[50];
```

The indentifier, or unique id, for non-fungible tokens may use 'int', 'uint', 'buff' and 'string' types.

To mint, burn, transfer, etc these tokens, see the [system calls](#system-calls) that start with "nft-", or use the corresponding properties of the non-fungible token:
```
persist nifty as nonfungible-token identified by string[50];

const alice = SP2JPBTPVXN7V5N0SH7ZP95GM1GTFVT8SKVAW3R77;
const bob = SP3WT3PT3NA5SWW82DZ8ZFK8RN412AD3KR5Q7Q3K4;

public function mint-and-give() {
    nifty.mint?("roo", alice);
    nifty.mint?("hardy", alice);
    nifty.transfer?("roo", alice, bob);
    nifty.burn?("hardy", alice);
    return ok( nifty.getOwner?("roo") );  // bob
}
```

## Functions

Crystalscript functions declared at the top level of the file compile to Clarity "define-public", "define-private", and "define-read-only" functions. Public and read-only functions are callable by other contracts.

A function declaration has the format:
```
VISIBILITY function NAME (NAME TYPE, ...) { STATEMENTS }
```

For example:

```
public readonly function cost (item string[10], basePrice int)
{
    if (item == "widget") { return ok(basePrice * 2); }
    else { return ok(basePrice); }
}
```

Visibility may be one of the following:

| Visibility | Description |
| ---------- | ----------- |
| private    | Callable only by other functions in the same contract. These functions may return any type. |
| public     | Callable by other contracts and by functions in the same contract. These functions must return a `response` type. |
| public readonly | Callable by other contract and by functions in the same contract. These functions should return a `response` type if they will be called by other contracts. |

If not given, a function will be private.


### Inner functions

Crystalscript allows function declarations within function bodies. These functions will appear as private functions at the global scope of the compiled Clarity contract. Inner functions may appear anywhere in a scope, as long as they're after after all `const` variables. These functions are "hoisted" so that they may be called by `const` variable expressions or from within the scope body even though their declaration may come after.

For example:

```
    public function cost(item string[10], basePrice int)
    {
        const widgetCost = compute(basePrice, 2);

        function compute(price int, factor int)
        {
            return price * factor;
        }

        if ( item == "widget" ) { return ok(widgetCost); }
        return ok(basePrice);
    }
```

More on inner functions can be found [here](#inner-function-definitions)

## Imports

If the crystalscript compiler is given the `--contract-name` argument (or the shortened form `-n`), it will create a `contract-name.import` file next to the `.clar` compiled output file.

For example, running the command:
```
crystalscript -n mycontract mycontract.crystal
```

will produce the two files:
```
    mycontract.crystal.clar
    mycontract.import
```

The import file contains declarations that allow other contracts to access it's public functions, read-only functions, trait definitions and trait implementations.

### Import statement

`import` has the following two syntaxes:

1. `import CONTRACT-ID from "/path/to/file.import" as ID;`
1. `import "/path/to/file.import" as ID;`

The first import statement requires a CONTRACT-ID and ID.

CONTRACT-ID is an abolute or relative contract principal. eg. "ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P.contract-name" or ".contract-name", respectively. And, ID is an identifier used to refer to the contract in the program.

The definitions of the imported file will be assocated with the contract-id specified. At deployment time, the contract must exist and contain those definitions or Stacks will reject the contract.

If the import file path is a relative path:

- ... and the path starts with "./". The file will be read relative to the script that contains the import statement. For example: "./ftcontract.import".
- ... otherwise, the import is loaded from the directory containing the well-known set of imports see [well known contracts](#well-known-contracts).

### Import for a specific Stacks network

The second import statement syntax lacks a CONTRACT-ID. This syntax requires that an additional file ("file.import.json") exists in the same directory as the import file, which contains a lookup table with the contract id for the *stacks network being compile for*.

The default stacks network is "dev", but can be changed to something else like "testnet" or "mainnet" with crystalscript argument `--net <network>`.

For example, SIP-009 defines trait "nft-trait". This trait exists on mainnet as "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait" and testnet as "ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.nft-trait".

To avoid having to maintain multiple source code files, eg. one for testnet and one for mainnet, simply create an import.json file for it:

```
{
    "contract-id": {
        "mainnet": "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait",
        "testnet": "ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.nft-trait",
        "dev": "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait"
    }
}
```

The compiler will first look for the network name in the "contract-id" map choosing the contract id from that key if it exists. If it doesn't exist, the compiler  will look for a key named "default" and use the contract-id associated with it. Otherwise, compilation will fail.



### Calling functions of other contracts

Let's say we have two contracts (files) "price.crystal" and "register.crystal". The "price.crystal" functions `get-itemid()` and `priceof()` are accessed by "register.crystal" by importing the `price.import` file using the syntax `import .price from "./price.import" as price`, then calling the functions using `price.get-itemid()` and `price.priceof()`.

Here is a concrete example:

```
// --------------------------------------------------------
// price.crystal
// --------------------------------------------------------
// compile with: "crystalscript -n price -t price.crystal"
// saved: price.crystal.clar
// saved: price.import

const noth_itemid = u2001;

public function get-itemid(item string[5]) {
    if (item == "noth") {
        return ok(noth_itemid);
    }
    else {
        return err(-1);
    }
}

public function priceof(itemid uint) {
    if (itemid == noth_itemid) {
        return ok(u1000);
    }
    else {
        return ok(u500);
    }
}
```

```
// --------------------------------------------------------
// register.crystal
// --------------------------------------------------------
// compile with: "crystalscript -t --no-newdb register.crystal"
// saved: register.crystal.clar

import .price from "./price.import" as price;

public function get-registration-cost(item string[5]) {
   const itemid = price.get-itemid(item);
   if (itemid.iserr()) {
       return err(itemid.errval);
   }
   return price.priceof(itemid.okval);
}

// TEST: get-registration-cost(u"noth") => ok: val==1000
```

### To compile these contracts from the command line

1. `crystalscript -n price -t price.crystal`
1. `crystalscript -t --no-newdb register.crystal`

Arguments:
- `-n`: names the contract
- `-t`: deploys the contract using `clarity-cli` (which must be installed and available in the path or specified with environment variable CLARITY_CLI)
- `--no-newdb`: tells the compiler not to reset the existing clarity vm database containing the `.price` contract deployed in the previous step

Eg:

```
> crystalscript -n price -t price.crystal
----------------------
compile price.crystal
----------------------
saved: price.crystal.clar
saved: price.import

run tests
creating new clarity vm db 'test_db'
deploy price.crystal.clar as ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P.price


> crystalscript -t --no-newdb register.crystal
-------------------------
compile register.crystal
-------------------------
saved: register.crystal.clar

run tests
deploy register.crystal.clar as ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P.test

test 1: (get-registration-cost u"noth")
  success: ok and 'val==1000' is true

1 tests, 0 failures, 1 successes
```


### Well known contracts

There are a few well known contracts that are included with crystalscript that can be imported into any script.

| Contract                          | Description |
| --------------------------------- | ----------- |
| nft-trait                         | Trait defined by SIP-009 for non-fungible tokens  |
| sip-010-trait-ft-standard         | Trait defined by SIP-010 for fungible tokens |
| sip013-semi-fungible-token-trait  | Trait defined by SIP-013 for semi-fungible tokens |
| sip013-transfer-many-trait        | Trait defined by SIP-013 for send many transfers |


These contracts can be imported with the following syntax:
```
import "CONTRACT" as NAME;
```

for example:
```
// import SIP-009 nft-trait contract
import "nft-trait" as nft-trait;

// implement nft-trait from the contract
implement trait nft-trait.nft-trait;

// required function of nft-trait
public function get-last-token-id() {
    return ok(u1);
}
//...
```

For more information see [https://github.com/stacksgov/sips](https://github.com/stacksgov/sips).

These contracts all have different contract id's depending on what stacks network you're deploying to (eg. testnet or mainnet). When compiling, use the `--net` argument to choose what network to compile for.



## Traits

In Clarity, a trait is essentially a named group of function definitions. Contracts define traits, implement traits and use traits.

More than one contract can implement the same trait, and Clarity allows functions to accept a contract that implements a specific trait as an argument, so at runtime, the contract can call whatever trait implementation it was passed.

Here are some terms:

- *trait definition* - a group of function definitions
- *trait implementation* - an implemetation of all functions described by a trait definition by a contract
- *trait type* - a crystalscript data type for a trait definition
- *trait function* - one of the trait's function definitions
- *"use a trait"* - means a contact has one or more functions that accept an argument having a trait type

Contracts may not implement or use the trait they're defining.


### Define a trait

To *define* a trait, use this syntax:

```
define trait NAME {
    public function NAME(TYPE, ...) => response<OKTYPE, ERRTYPE>,
    ...
};
```

### Implement a trait

To *implement* a trait, use the following syntax. This example assumes that a trait definition called `mytrait` has been defined by contract `.contract-with-trait` that has an import file at "./contract-with-trait.import". `mytrait` has a single function definition.

```
// import the contract containing the trait definition
import .contract-with-trait from "./contract-with-trait.import" as contract-with-trait;

// declare that we're implementing a trait defined by the contract
implement trait contract-with-trait.mytrait;

// implement the 'mytrait' trait function
public function NAME(TYPE, ...) {
    returns OK()-OR-ERR();
}
```

The compiler will ensure no trait functions are missed and that the function implementations have the same signatures as the trait definition.


### Use a trait

Using a trait means a contact has one or more functions that accept an argument having a trait type.

To *use a trait*, import the trait definition, then add a trait type argument to a function and call the desired trait function.

```
// import the contract containing the trait definition
import .contract-with-trait from "./contract-with-trait.import" as contract-with-trait;

// use the trait
public function callme(impl trait<contract-with-trait.mytrait>, str string[5]) {
    return impl.NAME(str);
}
```

### Execute a function that requires a trait as an argument

Finally, execute a function that uses a trait:

```
// import the contract that implements the trait "mytrait"
import .mytrait-impl from "./mytrait-impl.import" as mytrait-impl;

// import the contract that uses the trait "mytrait" (as in above, it
// contains a function named 'callme' that has a trait<"mytrait"> argument)
import .uses-trait from "./uses-trait.import" as uses-trait;

// call the function that uses "mytrait" by supplying the implementation
// contract as the argument
function whatever() {
   const x = uses-trait.callme(mytrait-impl, "hello");
   return ok(x);
}
```



## Types

Crystalscript supports all the same types as Clarity. Strings default to utf-8. To get an ascii string, use `"string".ascii()`, which tells the compiler to emit an ascii literal (it won't cause an additional function call).

#### Basic types

| Type | Description |                     Literal      | Example |
| ---- | ----------- |                     -------      | ------- |
| int  | Signed whole number |   [-]{digits}             | const n = -10; |
| uint | Unsigned positive whole number|"u"{digits}       | const n = u5; |
| bool | Boolean true/false | true or false | const b = true; |
| principal | relative or absolute contract id | .contract or stacks-address.contract | const p = .mycontract; const p2 = ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P.mycontract; |

#### Sequence types

| Type | Description |                     Literal      | Example |
| ---- | ----------- |                     -------      | ------- |
|string[LEN]|utf-8 string having a maximum length of LEN|text surrounded by double quotes| const str = "string"; |
|string-ascii[LEN]|ascii string having a maximum length of LEN|text surrounded by double quotes followed by a call to ascii()| const str = "string".ascii(); |
|buff[LEN]| Array of arbitrary bytes having a maximum length of LEN|starts with `0x` followed by a series of hexadecimal numbers| const b = 0x01FF; |
|list<TYPE>[LEN]| Array with maximum length LEN having elements all with the same type TYPE. | values between square brackets| const nums = [1,2,3]; const two = nums[1]; |

#### Map

| Type | Description |                     Literal      | Example |
| ---- | ----------- |                     -------      | ------- |
| map  | This type is called a tuple in Clarity. It's also referred to as an associative array and dictionary. The key/TYPE pairs are specified inside curly brackets. Values don't have to have the same TYPE.| { key:TYPE, ... } | const dict = { a:1, b:{ str:"abc" }}; |

#### Optional

| Type | Description |                     Literal      | Example |
| ---- | ----------- |                     -------      | ------- |
| optional TYPE | a type that may be 'none' or be TYPE | optional(value) | const op = optional(5); |

#### Response

| Type | Description |                     Literal      | Example |
| ---- | ----------- |                     -------      | ------- |
| response<OKTYPE,ERRTYPE> | a response wraps a value that is either designated as "ok" or "err" depending on how the response was contructed. An "ok" response has type OKTYPE, and "err" type ERRTYPE | ok(value) or err(value) | const resp = ok(u10); |

#### Other types

These are advanced types that have no literal construction.

| Type | Description |
| ---- | ----------- |
| trait\<TRAIT-DEF> |trait having a trait definition specified by TRAIT-DEF. See the topic on [traits](#traits). |
| datavar | A persisted variable created with `persist NAME as TYPE` |
| datamap | A persisted map created with `persist NAME as TYPE => TYPE` |
| ft   | A fungible token created by `persist fungible token` |
| nft  | A non-fungible token created by `persist nonfungible-token` |




### Type properties

Some types have properties that may be accessed with the dot operator. Below is a table of types and their supported properties along with the corresponding system call for it, if applicable.


| Type                 | Property      | System call     | Example          |
| -------------------- | ------------- | --------------- | ---------------- |
| string,              | .concat()     | concat          | "abc".len()      |
| string-ascii         | .indexOf?()   | index-of?       |                  |
|                      | .replaceAt?() | replace-at?     |                  |
|                      | .slice?()     | slice?          |                  |
|                      | .len()        | len             |                  |
|                      | .ascii()      |                 |                  |
|                      | .toInt?()     | string-to-int?  |                  |
|                      | .toUint?()    | string-to-uint? |                  |
|                      |               |                 |                  |
|                      |               |                 |                  |
| buff                 | .concat()     | concat          | 0x01.concat(0x02) |
|                      | .indexOf?()   | index-of?       |                  |
|                      | .replaceAt()  | replace-at?     |                  |
|                      | .slice?()     | slice?          |                  |
|                      | .len()        | len             |                  |
|                      |               |                 |                  |
| list                 | .concat()     | concat          | [1,2].indexOf?(2) |
|                      | .indexOf?     | index-of?       |                  |
|                      | .replaceAt?() | replace-at?     |                  |
|                      | .slice?()     | slice?          |                  |
|                      | .len()        | len             |                  |
|                      | .append()     | append          |                  |
|                      |               |                 |                  |
| int, uint            | .toStringAscii() | int-to-ascii | 5.toString()     |
|                      | .toString()   | int-to-utf8     |                  |
|                      |               |                 |                  |
| response             | .isok()       | is-ok           | const v = r.okval |
|                      | .iserr()      | is-err          |                  |
|                      | .okval        | unwrap-panic    |                  |
|                      | .errval       | unwrap-err-panic |                 |
|                      |               |                 |                  |
| ft                   | .getBalance() | ft-get-balance  | ft.getSupply() |
|                      | .getSupply()  | ft-get-supply   |                  |
|                      | .transfer?()  | ft-transfer?    |                  |
|                      | .mint?()      | ft-mint?        |                  |
|                      | .burn?()      | ft-burn?        |                  |
|                      |               |                 |                  |
| nft                  | .getOwner?()  | nft-get-owner?  | nft.getOwner(u1000) |
|                      | .transfer?()  | nft-transfer?   |                  |
|                      | .mint?()      | nft-mint?       |                  |
|                      | .burn?        | nft-burn?       |                  |



### Type conversion functions

| Function    |  Description | Example |
| ----------- |  ----------- | ------- |
| principal() | principal from string literal | principal(".contract") |
| optional()  | make optional | optional(a) |
| int()       | convert to int | int(a) |
| uint()      | convert to uint | uint(a) |


### Special literals

| Name   | Type |
| ------ | ---- |
| contract-caller | principal |
| tx-sender | principal |
| block-height | uint |
| burn-block-height | uint |
| stx-liquid-supply | uint |
| is-in-regtest | bool |

Please consult the [Clarity docs](https://docs.stacks.co/docs/clarity/) for details about these.


### Working with responses

Public functions in Clarity are required to return a response type. Crystalscript treats responses like an object with 4 properties:

| Response property | Description |
| -------- | ----------- |
| isok()   | this function returns true if the response is an ok response |
| iserr()  | this function returns true if the response is an err response |
| okval    | obtains the value of the ok response. Accessing this property when the response is an err response will cause a panic (the call will immediatly exit and fail) |
| errval   | obtains the value of an err response. Accessing this property when the response is an ok response will cause a panic (the call will immediately exit and fail) |

Examples of using a response object:

```
public function iseven(n int) {
   if ( n < 0 ) { return err(-1); }
   return n % 2 == 0 ? ok(true) : ok(false);
}

public function test_even(n int) {
   const even_response = iseven(n);
   if (even_response.isok()) {
       return ok(even_response.okval ? "yes" : "no");
   }
   return err(even_response.errval);
}
// TEST: test_even(5) => ok: val=="no"
// TEST: test_even(6) => ok: val=="yes"
// TEST: test_even(-1) => err: val==-1
``` 


### Working with optionals

Optionals in Clarity are just like other types except the item's value, in addition to a value of it's designated type, may be 'none' signifying a null or unset value.

#### Automatic unwrap

Accessing an optional value will cause an automatic unwrap (Clarity's mechanism for obtaining the optional's value). For example, sending optional(2) to 'fn' will return ok(4), but sending 'none' will cause a panic:

```
public readonly function fn(n optional int) {
    return ok(n * 2);
}
// TEST: fn((some 2)) => ok: val==4
// TEST: fn(none) => runtime-failure: /UnwrapFailure/.test(val.error)
```

This can be avoided by testing that the optional is not 'none':

```
public readonly function fn(n optional int) {
    if (n) { return ok(n * 2); }
    return err(-1);
}
// TEST: fn((some 2)) => ok: val==4
// TEST: fn(none) => err: val==-1
```

Note that `if (n)` is a 'truthy' test. Truthy for optionals means that the optional is not 'none' and is equivalent to `if (n != none)`. It does not mean that the value of n is truthy (ie. if n were 'false', truthy 'n' is still true).

#### Function call argument coercion

Functions that expect optionals as arguments, but are called with a concrete type will be made optional. In the example below, it's not necessary to call fn with 'optional(mybuf)', it can just be sent as-is:

```
function fn(buffer optional buff[100]) {
    const newbuf = concat(buffer, 0x00);
    return newbuf;
}
public function test() {
    const mybuf = 0x0504030201;
    return ok(fn(mybuf));
}
// TEST: test() => ok: val=="0x050403020100"
```


### Literal coersion

Where possible, 'int' and 'uint' types will be coerced to satisfy the expression or function argument type needed.

For example, function 'fn' below requires a 'uint' argument, but a literal 'int' is given and was coerced to a 'uint'. If the int was negative, a compiler TypeMismatchError will occur.

```
function fn(x uint) {
     return x*2;
}
public function test() {
     return ok(fn(5));
}
```

There is no literal coersion for system calls, except for those implemented as operators.

## Expressions

### Operators

Crystalscript supports the following operators:

| Operator | Name | Description | Example |
| -------- | ---- | ----------- | ------- |
| +        | add | add two numbers | 1 + 1 |
| -        | subtract | subtract one number from the other, or change the sign of a number | 2 - 1 |
| *        | multiply | multiply two numbers | 2 * 2 |
| /        | divide | divide one number by another | 4 / 2 |
| %        | modulo | division remainer | 5 % 2 |
| **       | power | raise one number to the power of another | 2 ** 4 |
| ^        | xor | exclusive or | 18 ^ 2 |
| >=       | gte | greater than or equal | a >= b |
| <=       | lte | less than or equal | a <= b |
| >        | gt | greater than | a > b |
| <        | lt | less than | a < b |
| ==       | eq | equals | a == b |
| !=       | ne | not equals | a != b |
| &&       | and | and | a && b |
| \|\|       | or | or | a || b |
| !        | not | not | ! a |
| #        | unwrap | unwrap optional | #a |
| ?:       | if-then  | if/then/else | a ? b : c |
| ()       | call | function call | concat( [1,2], [3, 4] ) |
| =        | assign | change a persistent variable or data map entry | data[{ index:1 }] = \{ amt:10 } |
| ?=       | conditional assign | change a data map entry if it doesn't exist | data[{ index:1 }] ?= \{ amt:5 } |
| delete   | delete | delete a data map entry | delete data[{ index:1 }] |
| []       | brackets | derefernce something | const amt = data[{ index:1 }]["amt"] |
| .        | dot      | dereferece something | const amt = data[{ index:1 }].amt |
| ~        | bitwise not | one's compliment | const x = ~n >>10;       |
| &        | bitwise and | bitwise and      | const x = u65 & u41;     |
| \|       | bitwise or  | bitwise or       | const x = u10 | u2;      |
| <<       | bitwise shift left | shift bits left | const x = u1 << 7; |
| >>       | bitwise shift right | shift bits right | const x = u8 >> 7; | 


### Keywords

The following words are reserved by crystalscript and can't used used as identifiers:

| Keyword | Keyword |
| ------- | ------- |
| _countof | int |
| _typedef | is-in-regtest |
| as | list |
| block-height | none |
| bool | nonfungible-token |
| buff | optional |
| burn-block-height | persist |
| const | principal |
| contract-caller | private |
| declare | public |
| define | readonly |
| delete | response |
| else | return |
| extern | string |
| false | string-ascii |
| foreach | string-utf8 |
| function | stx-liquid-supply |
| fungible-token | trait |
| if | true |
| implement | tx-sender |
| implements | uint |
| import | use |



## Statements

### const

A "const" is a constant. There are no standard variables in Clarity that allow you to update their value (except for persisted data).

Constants must be declared before any other statements, but can be used in any scope.

The following syntax is used to define a constant:
```
const NAME = EXPRESSION;
```

Example:

```
public function fn(bool b) {
   const N = 10;
   if (b) {
      const NN = N + N;
      return ok(NN);
   }
   return err(-1);
}
```

### if / else if / else

'If' statements have typical syntax:

```
if (EXPRESSION) {
   STATEMENTS
}
else if (EXPRESSION) {
   STATEMENTS
}
else {
   STATEMENTS
}
```

However, braces are always required.


### Inner function definitions

As discussed above in [functions](#functions), function bodies may contain function definitions of their own, called "inner" functions. Inner functions must appear after "const" statements and before return, but are hoisted so that they may be called by "const" expressions and expression in the function body.

During compilation, inner functions are renamed and made global since Clarity does not natively support them. Access to constants of the parent scope is allowed through closure.

Here is an example:

```
public function example() {
    const factor = 5;
    const x = getx_via_y();
    function getx_via_y() {
       function getx() {
           return 2 * factor;
       }
       return getx();
    }
    return ok(x);
}

```

### return

The syntax for return is:

```
return EXPRESSION
```

Return exits the function, returning the value given by the expressions. All functions are required to return a value.



## System calls

A system call ("syscall") is compiled to the equivalent Clarity function.

Familiarity with Clarity's functions is essential since crystalscript syscalls require the same number of arguments and return the same type as the equivalent Clarity function.

The syntax for making a system call is `fn(args, ...)`. For instance, list concatenation in crystalscript using concat: `concat([1,2], [3,4])` is compiled to `(concat (list 1 2) (list 3 4))` in Clarity. Same function name, same number and types of arguments.

Please consult the [Clarity docs](https://docs.stacks.co/docs/clarity/) for details on what arguments are acceptable and what return value to expect from making system calls.

Some Clarity functions are implemented as operators (eg. "&&" instead of "and", "||" instead of "or", etc) and some as type conversion functions ("int" instead of "to-int", etc). Crystalscript supports all Clarity functions either as an operator, or as a function call. The list below are the system calls that crystalscript supports as a function call.

Like in Clarity, functions that return a response or optional type end with '?', and those that could immediatly return from the function end with '!'.

| Function     | Description |
| ------------ | ----------- |
| append | append a single element to a list and returns the new list |
| as-contract | execute an expression as the contract instead of the caller |
| as-max-len? | changes the maximum size of a sequence |
| asserts! | assert that an expression is true, or return from the function |
| at-block |  |
| buff-to-int-be | convert a buff in big-endian to an integer |
| buff-to-int-le | convert a buff in little-endian to an integer |
| buff-to-uint-be | convert a buff in big-endian to an unsigned integer |
| buff-to-uint-le | convert a buff in little-endian to an unsigned integer |
| concat | concatenates two sequences and returns the new sequence |
| contract-call? | call pubic or readonly functions of other contracts |
| contract-of | get the principal implementing a trait |
| default-to | returns the given value unless it's none, in which case the supplied "default value" is returned instead |
| err | constructs an error response |
| filter | calls a function for each element of a list and returns a new list containing elements for which the function returned true |
| fold | obtain a value from a list where a function is called for each element of the list with the element plus the prior result |
| from-consensus-buff? | deserialize a buffer into a Clarity value |
| ft-burn? | remove tokens from the outstanding supply |
| ft-get-balance | fungible token balance of a principal |
| ft-get-supply | fungible token supply outstanding |
| ft-mint? | mint fungible tokens and increase outstanding supply |
| ft-transfer? | move fungible tokens between parties |
| get-block-info? |  |
| get-burn-block-info? |  |
| hash160 | compute hash |
| index-of? | find an element and return it's index within a sequence |
| int-to-ascii | convert number to string-ascii form |
| int-to-utf8 | convert number to string form |
| is-err | test whether a response is an err |
| is-none | test whether an optional is none |
| is-ok | test whether a response is ok |
| is-some | test whether an optional is not none |
| is-standard | tests whether the principal matches the current network type |
| keccak256 | compute hash |
| len | obtain the length of a sequence |
| log2 | base 2 logarithm |
| map | construct a new list from the return values of a function that's called for every element of other lists |
| merge | combine two maps into a new map |
| nft-burn? | destroy an nft |
| nft-get-owner? | obtain the owner of an nft |
| nft-mint? | create an nft |
| nft-transfer? | transfer an nft between parties |
| ok | constructs an ok response |
| principal-construct? | get a principal from a buffer |
| principal-destruct? | convert principal into details about the principal |
| principal-of? | get the principal from a public key |
| print | output event |
| replace-at? | returns a new list with the element at the selected index replaced with the new value |
| secp256k1-recover? | obtain the public key used to sign a message |
| secp256k1-verify | verify a signature |
| sha256 | compute hash |
| sha512 | compute hash |
| sha512-256 | compute hash |
| slice? | get a portion of a sequence |
| sqrti | integer square root |
| string-to-int? | convert a string to integer |
| string-to-uint? | convert a string to an unsigned integer |
| stx-account |  |
| stx-burn? | destroy stx |
| stx-get-balance | returns the principal's stx balance |
| stx-transfer-memo? | transfer stx between two parties, with a memo |
| stx-transfer? | transfer stx between two parties |
| to-consensus-buff? | serialize any value into a buffer |
| try! | return from the function if the response is err or the optional is none, otherwise returns the value |
| unwrap! | return from the function if the response is err, or the optional's value is none, otherwise returns the value |
| unwrap-err! | return from the function if the response is ok, otherwise returns the value |
| unwrap-err-panic | return from the function if the response is ok, otherwise return the value |
| unwrap-panic | return from the function if the response is err or the optional is none, otherwise return the value |


Please consult the [Clarity docs](https://docs.stacks.co/docs/clarity/) for details on what arguments are acceptable and what return value to expect from making system calls.

Also see [type conversion functions](#type-conversion-functions).


### foreach function

foreach is a built-in crystalscript function for which there is no equivalent function in Clarity.

foreach is a list iterator that constructs a new list from the return value of a function that's called for each list element.

Clarity does not support iteration by design. It does however have three system calls `map`, `fold` and `filter` that iterate over lists. Using `fold` as a generic iterator can be done manually but it's cumbersome. `foreach` takes care of the details to make iteration of lists easy.

foreach takes two arguments, the list to iterate over and a function that accepts the iteration element and returns another value. All the values returned by the function are returned by foreach as a list.

The iteration function must return the same type for every iteration. However the returned value does not have to be the same type as the list being iterated over.

There is no way to change the size of the list with foreach. The input list size and the returned list will always be the same length.

The function argument to foreach can be an anonymous function that accepts one or two arguments or an existing function that takes a single argument. The first argument to either function is always an element of the list. When using an anonymous function a second argument, that is not required, is the index of the list element as a 'uint' type. To access the index and use an existing function, provide an anonymous function that calls the existing function yourself.

Examples of using foreach:

```
// anonymous function with w/o index argument
public function foreachtest1() {
    const n = 100;
    const newarray = foreach([1,2,3], (item) => {
        return item * n;
    });
    return ok(newarray);
}

// anonymous function with index argument
public function foreachtest2() {
    const newarray = foreach([1,2,3], (item, idx) => {
        return uint(item) * idx;
    });
    return ok(newarray);
}

// existing function
private function foreachtest4-handler(n int) {
    return n * 2;
}
public function foreachtest4() {
    const newarray = foreach([1,2,3], foreachtest4-handler);
    return ok(newarray);
}
```



## Comments

Comments in crystalscript start with "//". Any text after the "//" up to the end of the line, is ignored.

```
// This is a comment
function cost() {
    return u1000;  // this is a comment
}
```

Comments are not passed through to the compiled Clarity code.


### Include comments in Clarity code

To include a comment in compiled code, add ";;" to the comment.

```
// This comment is dropped
// ;; This comment appears in generated Clarity code
function cost(name string[10]) {
    // ;; name: supply the name of the item you want the cost of
    if ( name == "abc" ) {
        return 10;  // ;; cost of "abc"
    }
    return -1;
}
```

The compiled code looks like:

```
;; This comment appears in generated Clarity code
;; returns int
(define-private (cost (name (string-utf8 10)))
   ;; name: supply the name of the item you want the cost of
   (begin
      (and (is-eq name u"abc")
           ;; cost of "abc"
           (asserts! false 10))
      -1))
```



## Embedded tests

When the `-t` command line argument is given to the compiler, it will run tests embedded in the source code after the contract has been deployed.

To deploy locally and run embedded tests, 'clarity-cli' from [stacks-blockchain](https://github.com/stacks-network/stacks-blockchain) must be installed and in the path (or its location specified by the CLARITY_CLI environment variable).

Clarity-cli provides a local mock Stacks environment.

Tests are added to source code in comments that start with "// TEST:". They have the following format:
```
// TEST: function-to-call(arguments) => ok|err|runtime-failure: javascript test script
```

- *function-to-call* is the name of a public function within the source code
- *arguments* are a comman separated list of arguments that the function should be called with. Arguments must be in Clarity syntax, so for example, a list argument must be supplied as the Clarity expression `(list 1 2 3)`. Because strings in crystalscript are utf-8, any string argument must be preceeded by 'u', for example `myfunction(u"string")`. Use Clarity's "some" function to create an optional, eg `myfunction((some 5))`.
- *ok|err|runtime-failure* are the expected response type
- *javscript test script* is a script that returns true or false to indicate whether the function call returned the expected value.

For 'ok' and 'err' response types, the variable `val` contains the function result. If a `runtime-failure` occurs, `val` will contain wording that can be matched by regular expression or whatever in javascript.

If a test fails, everything Stacks returned will be output for diagnostics.

There are lots of examples in the `tests` directory.


