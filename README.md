[![tests](https://github.com/crystalscript/crystalscript/actions/workflows/commit-tests.yml/badge.svg)](https://github.com/crystalscript/crystalscript/actions)

# Crystal Script - compiler for Stacks smart contracts

Crystal Script transforms the crystalscript language into Clarity, the smart contract language for deployment on the Stacks blockchain.

For more information about Stacks and Clarity, see:

Stacks: [https://www.stacks.co/](https://www.stacks.co/)

Clarity: [https://docs.stacks.co/docs/clarity/](https://docs.stacks.co/docs/clarity/)


## Installation

```
$ npm install -g crystalscript
```

## What does crystalscript look like?

Here is a sample smart contract in crystalscript for a self-service "mbot" NFT:

```
// create on-chain storage for the mbot NFT
persist mbot as nonfungible-token identified by string[50];

// Mint your own mbot!
public function mint-mbot-nft(name string[50])
{
    const result = nft-mint?(mbot, name, tx-sender);
    if (result.iserr()) {
         // sorry, that name is taken...
         return err(false);
    }
    // congratulations, you have a new mbot!
    return ok(true);
}

// TEST: mint-mbot-nft(u"Ava") => ok: val===true

```

## How to use

#### Compile a smart contract to Clarity
```
$ crystalscript /path/to/file.crystal
saved: /path/to/file.crystal.clar
```

#### Compile a smart contract so it can be shared (imported by other crystalscript contracts)
```
$ crystalscript -n mbot-nft mbot.crystal
saved: mbot.crystal.clar
saved: mbot-nft.import
```

#### Compile a smart contract, deploy it with clarity-cli, then run embedded tests*
```
$ crystalscript -t mbot.crystal
saved: mbot.crystal.clar

run tests
creating new clarity vm db 'test_db'
deploy mbot.crystal.clar as ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P.test

test 1: (mint-mbot-nft u"Ava")
  success: ok and 'val===true' is true
```
 
*\* Note: to deploy and run embedded tests locally in a mock Stacks environment, 'clarity-cli' from [stacks-blockchain](https://github.com/stacks-network/stacks-blockchain) must be installed and in the path (or its location specified by the CLARITY_CLI environment variable).*

crystalscript does not deploy compiled code to Stacks testnet and mainnet. You could try [@stacks/cli](https://www.npmjs.com/package/@stacks/cli) for that.


For additional compilation options, run `crystalscript` with no arguments.



## Documentation

Crystal Script's syntax is similar to javascript.

For language details, please see the Crystal Script Language Reference [docs/language-reference.md](docs/language-reference.md)


## Why a new language?

The author believes Clarity is difficult to use and that the Stacks ecosystem could benefit from a language that is easier to understand and maintain.

For example, the Crystal Script expression "(~n >> u124) + u1" would be coded, using Clarity's "pure functional", Lisp-like syntax, as "(+ (bit-shift-right (bit-not n) u124) u1))". Although this is a simple example, you can see how it could get difficult to read in a larger context.


## Support

This is an open source project and the project owners hope you find it useful. However, they may or may not have time to answer questions!

If you do have questions, please seek answers yourself before opening an issue. Otherwise, issues can be posted on GitHub. Pull requests are also welcome, but please see CONTRIBUTING.md.


## License
Crystal Script is licensed under the terms of GPL v3.0 or later. See the LICENSE file for details. Any Clarity code produced by the compiler is specifically excluded from any licensing terms, including the GPL.

crystalscript uses the [Jison](https://github.com/zaach/jison/) compiler-compiler, Copyright (c) 2009-2014 Zachary Carter.
