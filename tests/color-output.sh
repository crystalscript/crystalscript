
# ansi escapes for hilighting text
F_DANGER=$(echo -e "\033[31m")
F_WARN=$(echo -e "\033[93m")
F_SUCCESS=$(echo -e "\033[32m")
F_RESET=$(echo -e "\033[39m")


success() {
    local echoarg
    case "$1" in
        -n )
            echoarg="$1"
            shift
            ;;
        * )
            echoarg=""
    esac
    echo $echoarg "${F_SUCCESS}$1${F_RESET}"
}

danger() {
    local echoarg
    case "$1" in
        -n )
            echoarg="$1"
            shift
            ;;
        * )
            echoarg=""
    esac
    echo $echoarg "${F_DANGER}$1${F_RESET}"
}

warn() {
    local echoarg
    case "$1" in
        -n )
            echoarg="$1"
            shift
            ;;
        * )
            echoarg=""
    esac
    echo $echoarg "${F_WARN}$1${F_RESET}"
}

H1() {
    local msg="$1"
    echo "----------------------------------------------"
    if [ ! -z "$msg" ]; then
        echo "           $msg"
        echo "----------------------------------------------"
    fi
}

H2() {
    local msg="$1"
    if [ -z "$msg" ]; then
        echo "***"
    else
        echo "*** $msg ***"
    fi
}

