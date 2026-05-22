#!/bin/bash

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

EXIT_CODE=0

echo -e "${BLUE}Running Local Repository Secrets Auditor...${NC}"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    JS_FILES=$(git ls-files --cached --others --exclude-standard | grep -v "node_modules/" | grep '\.js$' || true)
    ENV_FILES=$(git ls-files --cached --others --exclude-standard | grep -v "node_modules/" | grep '\.env$' || true)
    ALL_FILES=$(git ls-files --cached --others --exclude-standard | grep -v "node_modules/" || true)
else
    JS_FILES=$(find . -type d \( -name node_modules -o -name .git -o -name backups -o -name logs \) -prune -o -type f -name "*.js" -print || true)
    ENV_FILES=$(find . -type d \( -name node_modules -o -name .git -o -name backups -o -name logs \) -prune -o -type f -name ".env" -print || true)
    ALL_FILES=$(find . -type d \( -name node_modules -o -name .git -o -name backups -o -name logs \) -prune -o -type f -print || true)
fi

if [ -n "$ENV_FILES" ]; then
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            echo -e "${RED}[HIGH]${NC} $file:1 - .env file found in repository (must not be committed)"
            EXIT_CODE=1
        fi
    done <<< "$ENV_FILES"
fi

scan_pattern() {
    local pattern="$1"
    local severity="$2"
    local desc="$3"
    if [ -z "$JS_FILES" ]; then return; fi
    local color=$YELLOW
    if [ "$severity" = "HIGH" ]; then color=$RED; elif [ "$severity" = "LOW" ]; then color=$BLUE; fi
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            local matches
            matches=$(grep -nE "$pattern" "$file" 2>/dev/null || true)
            if [ -n "$matches" ]; then
                while IFS= read -r line; do
                    local line_num
                    line_num=$(echo "$line" | cut -d':' -f1)
                    echo -e "${color}[${severity}]${NC} $file:$line_num - $desc matched"
                    EXIT_CODE=1
                done <<< "$matches"
            fi
        fi
    done <<< "$JS_FILES"
}

scan_pattern_all() {
    local pattern="$1"
    local severity="$2"
    local desc="$3"
    if [ -z "$ALL_FILES" ]; then return; fi
    local color=$YELLOW
    if [ "$severity" = "HIGH" ]; then color=$RED; elif [ "$severity" = "LOW" ]; then color=$BLUE; fi
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            local matches
            matches=$(grep -nE "$pattern" "$file" 2>/dev/null || true)
            if [ -n "$matches" ]; then
                while IFS= read -r line; do
                    local line_num
                    line_num=$(echo "$line" | cut -d':' -f1)
                    echo -e "${color}[${severity}]${NC} $file:$line_num - $desc matched"
                    EXIT_CODE=1
                done <<< "$matches"
            fi
        fi
    done <<< "$ALL_FILES"
}

scan_pattern "sk-[a-zA-Z0-9]{20,}" "HIGH" "OpenAI-style key"
scan_pattern "ghp_[a-zA-Z0-9]{36}" "HIGH" "GitHub personal access token"
scan_pattern "[A-Za-z0-9]{32,64}" "LOW" "Generic long hex/base64 key"
scan_pattern "Bearer[[:space:]]+[A-Za-z0-9\-_]{20,}" "HIGH" "Bearer token"
scan_pattern "api[_-]?key[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9]{16,}[\"']?" "HIGH" "API key assignment"

if [ -n "$JS_FILES" ]; then
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            matches=$(grep -nE "TELEGRAM_TOKEN|GITHUB_TOKEN|OPENROUTER_API_KEY|OWNER_ID" "$file" 2>/dev/null | grep -Ev "process\.env\.(TELEGRAM_TOKEN|GITHUB_TOKEN|OPENROUTER_API_KEY|OWNER_ID)"  | grep -Ev "'(TELEGRAM_TOKEN|GITHUB_TOKEN|OPENROUTER_API_KEY|OWNER_ID)'" || true)
            if [ -n "$matches" ]; then
                while IFS= read -r line; do
                    if [ -n "$line" ]; then
                        line_num=$(echo "$line" | cut -d':' -f1)
                        echo -e "${RED}[HIGH]${NC} $file:$line_num - Hardcoded string literal for env var"
                        EXIT_CODE=1
                    fi
                done <<< "$matches"
            fi
        fi
    done <<< "$JS_FILES"
fi

scan_pattern_all "-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----" "HIGH" "Private key"
scan_pattern_all "(postgres|mysql)://.*:.*@" "HIGH" "Database connection string with password"

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Scan complete. No secrets found. Safe to proceed.${NC}"
else
    echo -e "${RED}Scan complete. Secrets found! Please remove them and try again.${NC}"
fi

exit $EXIT_CODE
