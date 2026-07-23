#!/bin/bash

# This script assumes you have emsdk installed and activated in your environment.
# It also assumes you have raylib and bullet source or precompiled wasm libraries.

# 1. Define paths (Update these to your local paths)
RAYLIB_PATH="path/to/raylib"
BULLET_PATH="path/to/bullet"

# 2. Compile
emcc main_web.cpp -o index.html \
    -I. -I$RAYLIB_PATH/src -I$BULLET_PATH/src \
    -L. -lraylib -lBulletDynamics -lBulletCollision -lLinearMath \
    -s USE_GLFW=3 \
    -s ASYNCIFY \
    -s TOTAL_MEMORY=67108864 \
    -s FORCE_FILESYSTEM=1 \
    -DPLATFORM_WEB \
    --preload-file mowbot.stl \
    --shell-file shell.html

echo "Build complete. Run 'python3 -m http.server' and open localhost:8000"
