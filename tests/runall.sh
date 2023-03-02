#!/bin/bash

D=$(dirname "$BASH_SOURCE")
. "$D/funcs.sh" || exit 1
. "$D/color-output.sh" || exit 1


debug=""
if [ "$1" = "-d" ]; then
    debug="$1"
    shift
fi


runtest() {
    local src="$1"
    local tmp=$(mktemp)
    local code=0

    case "$src" in
        *.sh )
            echo -n "TEST: $src: "
            $src $debug >$tmp
            code=$?
            ;;
        * )
            echo -n "TEST: ../src/c2c.js -t -d $src: "
            ../src/c2c.js -t $debug $src >$tmp
            code=$?
            ;;
    esac
    
    if [ $code -ne 0 ]; then
        danger "FAILURE"
        H1 "OUTPUT from $src"
        cat $tmp
        echo ""
        rm $tmp
        exit 1
    fi
    success "SUCCESS"
    # if [ "$debug" = "-d" ]; then
    #     H1 "OUTPUT from $src"
    #     cat $tmp
    #     echo ""
    # fi
    rm $tmp
}

# operate from the tests directory
set_wd_tests

if [ ! -z "$1" ]; then
    fn="$(find . -name "$1")"
    [ -z "$fn" ] && fn="$(find . -name "$1.crystal")"
    runtest "$fn"
    exit 0
fi

runtest recursion/recursion1.crystal
runtest recursion/recursion2.crystal
runtest recursion/recursion3.crystal
runtest recursion/recursion4.crystal
runtest recursion/recursion5.crystal

runtest contract-call/cc1.sh
runtest trait/trait1.sh
runtest trait/trait2.sh

runtest none/none1.crystal
runtest none/none2.crystal
runtest none/none3.crystal
runtest none/none4.crystal

runtest literals.crystal
runtest literal-coersion.crystal
runtest literal-coersion2.crystal
runtest literal-special.crystal

runtest readonly-violation.crystal
runtest readonly-violation2.crystal
runtest readonly-violation3.crystal

runtest keyword-as-id.crystal
runtest keyword-as-id2.crystal
runtest keyword-as-id3.crystal
runtest keyword-as-id4.crystal

runtest scopes/undeclared.crystal
runtest scopes/redeclare.crystal
runtest scopes/redeclare2.crystal
runtest scopes/redeclare3.crystal
runtest scopes/redeclare4.crystal
runtest scopes/redeclare5.crystal
runtest scopes/redeclare6.crystal
runtest scopes/redeclare7.crystal
runtest scopes/redeclare8.crystal
runtest scopes/redeclare9.crystal
runtest scopes/redeclare10.crystal
runtest scopes/inner-funcs.crystal
runtest scopes/inner-funcs2.crystal
runtest scopes/backfill.crystal
runtest scopes/backfill2.crystal

runtest func-reference.crystal
runtest func-reference2.crystal
runtest func-reference3.crystal

runtest return.crystal
runtest return2.crystal
runtest return3.crystal 2>/dev/null
runtest return4.crystal

runtest optionals.crystal
runtest optionals2.crystal

runtest response.crystal

runtest math.crystal

runtest foreach.crystal

runtest map-size-issue.crystal

runtest persist/persist.crystal
runtest persist/persist2.crystal
runtest persist/ft.crystal
runtest persist/nft.crystal
runtest persist/nft_sip009.crystal
runtest persist/ft_sip010.crystal
runtest persist/sft_sip013.crystal

runtest brackets.crystal
runtest if-permutations.crystal

runtest syscall/as-max-len.crystal
runtest syscall/as-max-len2.crystal
runtest syscall/merge.crystal
runtest syscall/map.crystal
runtest syscall/map2.crystal
runtest syscall/fold.crystal
runtest syscall/append.crystal
runtest syscall/concat.crystal
runtest syscall/len.crystal
runtest syscall/index-of.crystal
runtest syscall/filter.crystal
runtest syscall/asserts.crystal
runtest syscall/asserts2.crystal
