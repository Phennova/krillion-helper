#!/bin/sh
# The Chrome build shares its code with the Firefox one in extension/.
# Run this after editing extension/*.js to copy the changes across.
cd "$(dirname "$0")" && cp extension/content.js extension/background.js extension-chrome/ && echo "extension-chrome/ updated"
