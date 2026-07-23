cmake_minimum_required(VERSION 3.10)
project(MowbotSim)

set(CMAKE_CXX_STANDARD 11)

# Find Bullet
find_package(Bullet REQUIRED)

# Find Raylib
find_package(raylib REQUIRED)

include_directories(
    ${BULLET_INCLUDE_DIRS}
)

add_executable(mowbot_sim main.cpp)

target_link_libraries(mowbot_sim 
    ${BULLET_LIBRARIES}
    raylib
)
