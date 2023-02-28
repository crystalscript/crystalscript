#!/bin/bash

set_wd_tests() {
    local d="$(pwd)"

    while [ ! -e "$d/src/c2c.js" -a "$d" != "/" ]; do
        d="$(dirname "$d")"
    done
    
    if [ ! -e "$d/src/c2c.js" ]; then
        echo "Could not find c2c.js" 1>&2
        exit 1
    fi

    pushd "$d/tests" >/dev/null || exit 1
}
