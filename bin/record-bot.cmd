@echo off
setlocal
set "ROOT=%~dp0.."
node --experimental-strip-types "%ROOT%\cli\index.ts" %*
