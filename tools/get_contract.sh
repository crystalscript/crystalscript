#!/bin/bash

usage() {
    echo "usage: $0 mainnet|testnet stx-address contract-name"
    echo "   eg: $0 mainnet SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE sip-010-trait-ft-standard"
    exit 0
}

if [ -z "$3" ]; then
    usage
fi


if ! jq --version >/dev/null 2>&1; then
    echo "FATAL: please install jq, it's not in your path"
    exit 1
fi
if ! wget --version >/dev/null 2>&1; then
    echo "FATAL: please install wget, it's not in your path"
    exit 1
fi


net="$1"  # "mainnet", "testnet"
stx_addr="$2"
contract_name="$3"

default_dest_path="$(dirname "$0")/../contracts/$net/$stx_addr.$contract_name.clar"
dest_path=$(realpath -m "${4:-$default_dest_path}")

if [ -e "$dest_path" ]; then
    echo "Already exists: $dest_path"
    exit 0
fi

if [ "$net" = "testnet" ]; then
    net=$(cat <<EOF | node --input-type=module
import net from '@stacks/network';
var n = new net.StacksTestnet();
console.log(n.coreApiUrl);
EOF
       )
elif [ "$net" = "mainnet" ]; then
    net=$(cat <<EOF | node --input-type=module
import net from '@stacks/network';
var n = new net.StacksMainnet();
console.log(n.coreApiUrl);
EOF
       )
else
    echo "Expected 'mainnet' or 'testnet', but got '$net'"
    exit 1
fi

url="$net/v2/contracts/source/$stx_addr/$contract_name?proof=0"
echo "URL: $url"
mkdir -p "$(dirname "$dest_path")"
wget --secure-protocol=PFS -q -O "$dest_path.info" "$url"
code=$?

if [ $code -ne 0 ]; then
    echo "FAILED! wget returned $code!"
    wget --secure-protocol=PFS -nv -O "$dest_path.info" "$url"
    rm -f "$dest_path";
    rm -f "$dest_path.info";
else
    jq -r .source "$dest_path.info" > "$dest_path"
    mv "$dest_path.info" "$dest_path.info_x";
    jq -c "del(.source)" "$dest_path.info_x" >"$dest_path.info"
    rm -f "$dest_path.info_x"
    echo "SUCCESS : $dest_path"
fi
exit $code
