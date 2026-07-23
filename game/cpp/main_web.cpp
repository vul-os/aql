#include "raylib.h"
#include "raymath.h"
#include "rlgl.h"
#include <btBulletDynamicsCommon.h>
#include <vector>
#include <iostream>
#include <cmath>
#include <random>
#include <algorithm>
#include <fstream>

#if defined(PLATFORM_WEB)
    #include <emscripten/emscripten.h>
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// --- Data Structures ---

struct GrassClump {
    btVector3 pos;
    float phase;
    float speed_mult;
    bool cut;
    int visual_index;
    Color color;
};

struct BladeMesh {
    std::vector<Vector3> vertices;
};

// --- Helpers ---

float random_float(float min, float max) {
    static std::mt19937 gen(std::random_device{}());
    std::uniform_real_distribution<float> dist(min, max);
    return dist(gen);
}

BladeMesh create_grass_clump_mesh(int num_blades, float radius) {
    BladeMesh mesh;
    for (int i = 0; i < num_blades; ++i) {
        float r = std::sqrt(random_float(0, 1)) * radius;
        float angle = random_float(0, 2 * M_PI);
        float x = r * std::cos(angle);
        float y = r * std::sin(angle);
        
        float h = random_float(0.2f, 0.5f);
        float w = random_float(0.01f, 0.025f);
        float yaw = random_float(0, 2 * M_PI);
        
        float cos_y = std::cos(yaw);
        float sin_y = std::sin(yaw);
        
        // Local triangle vertices
        Vector3 v0 = { -w/2.0f, 0, 0 };
        Vector3 v1 = { w/2.0f, 0, 0 };
        Vector3 v2 = { 0, 0, h };
        
        auto rotate_and_add = [&](Vector3 v) {
            float rx = v.x * cos_y - v.y * sin_y + x;
            float ry = v.x * sin_y + v.y * cos_y + y;
            mesh.vertices.push_back({ rx, ry, v.z });
        };
        
        rotate_and_add(v0);
        rotate_and_add(v1);
        rotate_and_add(v2);
    }
    return mesh;
}

// Custom Binary STL Loader
Mesh LoadSTLMesh(const char* fileName) {
    Mesh mesh = { 0 };
    std::ifstream file(fileName, std::ios::binary);
    if (!file.is_open()) return mesh;

    char header[80];
    file.read(header, 80);

    uint32_t triangleCount;
    file.read(reinterpret_cast<char*>(&triangleCount), 4);

    mesh.vertexCount = triangleCount * 3;
    mesh.triangleCount = triangleCount;
    mesh.vertices = (float*)MemAlloc(mesh.vertexCount * 3 * sizeof(float));
    mesh.normals = (float*)MemAlloc(mesh.vertexCount * 3 * sizeof(float));

    for (uint32_t i = 0; i < triangleCount; i++) {
        float n[3], v1[3], v2[3], v3[3];
        uint16_t attr;

        file.read(reinterpret_cast<char*>(n), 12);
        file.read(reinterpret_cast<char*>(v1), 12);
        file.read(reinterpret_cast<char*>(v2), 12);
        file.read(reinterpret_cast<char*>(v3), 12);
        file.read(reinterpret_cast<char*>(&attr), 2);

        for (int j = 0; j < 3; j++) {
            mesh.vertices[i * 9 + j] = v1[j];
            mesh.vertices[i * 9 + 3 + j] = v2[j];
            mesh.vertices[i * 9 + 6 + j] = v3[j];

            mesh.normals[i * 9 + j] = n[0];
            mesh.normals[i * 9 + 3 + j] = n[1];
            mesh.normals[i * 9 + 6 + j] = n[2];
        }
    }

    file.close();
    UploadMesh(&mesh, false);
    return mesh;
}

// --- Simulation Class ---

class MowbotSimulation {
public:
    MowbotSimulation() {
        collisionConfiguration = new btDefaultCollisionConfiguration();
        dispatcher = new btCollisionDispatcher(collisionConfiguration);
        overlappingPairCache = new btDbvtBroadphase();
        solver = new btSequentialImpulseConstraintSolver();
        dynamicsWorld = new btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
        dynamicsWorld->setGravity(btVector3(0, 0, -9.81f));
    }

    void setup() {
        // Load Mowbot Model using custom loader
        Mesh mesh = LoadSTLMesh("mowbot.stl");
        if (mesh.vertexCount > 0) {
            mowbotModel = LoadModelFromMesh(mesh);
            std::cout << "Successfully loaded mowbot.stl with " << mesh.vertexCount << " vertices" << std::endl;
        } else {
            std::cerr << "Failed to load mowbot.stl" << std::endl;
        }
        
        // Apply scale from Python: [0.002, 0.002, 0.002]
        mowbotModel.transform = MatrixScale(0.002f, 0.002f, 0.002f);
        
        float patch_size = 15.0f;
        
        // Ground
        btCollisionShape* groundShape = new btBoxShape(btVector3(patch_size / 2.0f, patch_size / 2.0f, 0.01f));
        btTransform groundTransform;
        groundTransform.setIdentity();
        groundTransform.setOrigin(btVector3(0, 0, -0.01f));
        btDefaultMotionState* groundMotionState = new btDefaultMotionState(groundTransform);
        btRigidBody::btRigidBodyConstructionInfo groundRbInfo(0, groundMotionState, groundShape, btVector3(0, 0, 0));
        btRigidBody* groundBody = new btRigidBody(groundRbInfo);
        dynamicsWorld->addRigidBody(groundBody);

        // Grass Clumps
        float spacing = 0.7f;
        float jitter = 0.3f;
        int num_steps = (int)(patch_size / spacing);
        float start_offset = -patch_size / 2.0f + spacing / 2.0f;

        for (int i = 0; i < 12; ++i) {
            visual_variations.push_back(create_grass_clump_mesh(80, 0.4f));
        }

        for (int i = 0; i < num_steps; ++i) {
            for (int j = 0; j < num_steps; ++j) {
                float x = start_offset + i * spacing + random_float(-jitter, jitter);
                float y = start_offset + j * spacing + random_float(-jitter, jitter);
                x = std::max(-patch_size / 2.0f + 0.2f, std::min(patch_size / 2.0f - 0.2f, x));
                y = std::max(-patch_size / 2.0f + 0.2f, std::min(patch_size / 2.0f - 0.2f, y));

                GrassClump clump;
                clump.pos = btVector3(x, y, 0.005f);
                clump.phase = random_float(0, 2 * M_PI);
                clump.speed_mult = random_float(0.8f, 1.2f);
                clump.cut = false;
                clump.visual_index = rand() % visual_variations.size();
                
                float g = random_float(0.4f, 0.65f);
                clump.color = { (unsigned char)(0.1f * 255), (unsigned char)(g * 255), (unsigned char)(0.1f * 255), 255 };
                
                clumps.push_back(clump);
            }
        }

        // Mowbot Physics
        btCollisionShape* mowbotShape = new btBoxShape(btVector3(0.4f, 0.3f, 0.2f));
        btTransform mowbotTrans;
        mowbotTrans.setIdentity();
        mowbotTrans.setOrigin(btVector3(0, 0, 0.2f));

        btScalar mass(2.0f);
        btVector3 inertia(0, 0, 0);
        mowbotShape->calculateLocalInertia(mass, inertia);
        
        btDefaultMotionState* mowbotMS = new btDefaultMotionState(mowbotTrans);
        btRigidBody::btRigidBodyConstructionInfo mowbotRbInfo(mass, mowbotMS, mowbotShape, inertia);
        mowbotBody = new btRigidBody(mowbotRbInfo);
        mowbotBody->setAngularFactor(btVector3(0, 0, 1));
        dynamicsWorld->addRigidBody(mowbotBody);
    }

    void update(float dt) {
        time_elapsed += dt;
        
        btTransform trans = mowbotBody->getWorldTransform();
        btVector3 pos = trans.getOrigin();
        btScalar yaw, pitch, roll;
        trans.getRotation().getEulerZYX(yaw, pitch, roll);

        float move = 0, turn = 0;
        float move_speed = 1.2f, turn_speed = 2.0f;
        
        if (IsKeyDown(KEY_UP)) move = move_speed;
        if (IsKeyDown(KEY_DOWN)) move = -move_speed;
        if (IsKeyDown(KEY_LEFT)) turn = turn_speed;
        if (IsKeyDown(KEY_RIGHT)) turn = -turn_speed;

        btVector3 linear_vel(move * std::cos(yaw), move * std::sin(yaw), 0);
        btVector3 current_vel = mowbotBody->getLinearVelocity();
        mowbotBody->setLinearVelocity(btVector3(linear_vel.x(), linear_vel.y(), current_vel.z()));
        mowbotBody->setAngularVelocity(btVector3(0, 0, turn));

        dynamicsWorld->stepSimulation(dt, 10);

        float cut_radius = 0.4f;
        for (auto& clump : clumps) {
            if (clump.cut) continue;
            if (pos.distance(clump.pos) < cut_radius) {
                clump.cut = true;
                continue;
            }
        }
    }

    void render() {
        // Ground
        DrawCube({ 0, 0, -0.01f }, 15.0f, 15.0f, 0.02f, { 13, 31, 13, 255 });

        // Grass
        float wind_speed = 1.5f, wind_strength = 0.08f;
        for (auto& clump : clumps) {
            if (clump.cut) continue;
            
            float wave = std::sin(time_elapsed * wind_speed * clump.speed_mult + (clump.pos.x() + clump.pos.y()) * 0.4f + clump.phase);
            float r_w = wave * wind_strength;
            float p_w = wave * wind_strength * 0.5f;
            
            Matrix rotation = MatrixRotateXYZ({ p_w, r_w, 0 });
            
            const BladeMesh& mesh = visual_variations[clump.visual_index];
            for (size_t i = 0; i < mesh.vertices.size(); i += 3) {
                Vector3 v0 = Vector3Transform(mesh.vertices[i], rotation);
                Vector3 v1 = Vector3Transform(mesh.vertices[i+1], rotation);
                Vector3 v2 = Vector3Transform(mesh.vertices[i+2], rotation);
                
                Vector3 p = { (float)clump.pos.x(), (float)clump.pos.y(), (float)clump.pos.z() };
                DrawTriangle3D(Vector3Add(p, v0), Vector3Add(p, v1), Vector3Add(p, v2), clump.color);
            }
        }

        // Mowbot
        btTransform t = mowbotBody->getWorldTransform();
        btVector3 p = t.getOrigin();
        btQuaternion q = t.getRotation();
        
        // Convert Bullet transform to Raylib
        Matrix physicsMat = QuaternionToMatrix({ (float)q.x(), (float)q.y(), (float)q.z(), (float)q.w() });
        physicsMat.m12 = p.x(); physicsMat.m13 = p.y(); physicsMat.m14 = p.z();
        
        // Apply physics transform to model
        mowbotModel.transform = MatrixMultiply(MatrixScale(0.002f, 0.002f, 0.002f), physicsMat);
        
        // Draw the model
        DrawModel(mowbotModel, { 0, 0, 0 }, 1.0f, RED);
        
        // Debug: Draw coordinate axes at mowbot position
        DrawLine3D({ (float)p.x(), (float)p.y(), (float)p.z() }, { (float)p.x() + 1, (float)p.y(), (float)p.z() }, RED);   // X
        DrawLine3D({ (float)p.x(), (float)p.y(), (float)p.z() }, { (float)p.x(), (float)p.y() + 1, (float)p.z() }, GREEN); // Y
        DrawLine3D({ (float)p.x(), (float)p.y(), (float)p.z() }, { (float)p.x(), (float)p.y(), (float)p.z() + 1 }, BLUE);  // Z
    }

    btVector3 getMowbotPos() { return mowbotBody->getWorldTransform().getOrigin(); }
    
    void cleanup() {
        UnloadModel(mowbotModel);
    }

private:
    btDefaultCollisionConfiguration* collisionConfiguration;
    btCollisionDispatcher* dispatcher;
    btBroadphaseInterface* overlappingPairCache;
    btSequentialImpulseConstraintSolver* solver;
    btDiscreteDynamicsWorld* dynamicsWorld;
    btRigidBody* mowbotBody;
    std::vector<GrassClump> clumps;
    std::vector<BladeMesh> visual_variations;
    Model mowbotModel;
    float time_elapsed = 0;
};

// --- Global State for Emscripten ---
MowbotSimulation* sim = nullptr;
Camera3D camera = { 0 };

void UpdateDrawFrame(void) {
    float dt = GetFrameTime();
    sim->update(dt);

    // Update Camera to follow
    btVector3 p = sim->getMowbotPos();
    float distance = 4.0f;
    float yaw = 45.0f * DEG2RAD;
    float pitch = 30.0f * DEG2RAD; 
    
    camera.target = { (float)p.x(), (float)p.y(), (float)p.z() };
    camera.position = { 
        (float)p.x() + distance * cosf(pitch) * sinf(yaw),
        (float)p.y() - distance * cosf(pitch) * cosf(yaw),
        (float)p.z() + distance * sinf(pitch) 
    };

    BeginDrawing();
        ClearBackground(SKYBLUE);
        BeginMode3D(camera);
            sim->render();
            
            // Draw Grid on XY plane (Z=0)
            rlPushMatrix();
                rlRotatef(90, 1, 0, 0); // Rotate XZ grid to XY
                DrawGrid(20, 1.0f);
            rlPopMatrix();
            
        EndMode3D();
        
        DrawFPS(10, 10);
        DrawText("Use ARROW KEYS to move", 10, 40, 20, DARKGRAY);
    EndDrawing();
}

int main() {
    const int screenWidth = 1024;
    const int screenHeight = 768;

    InitWindow(screenWidth, screenHeight, "Mowbot Sim Wasm (Raylib)");

    sim = new MowbotSimulation();
    sim->setup();

    camera.up = { 0.0f, 0.0f, 1.0f };
    camera.fovy = 45.0f;
    camera.projection = CAMERA_PERSPECTIVE;

#if defined(PLATFORM_WEB)
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    SetTargetFPS(60);
    while (!WindowShouldClose()) {
        UpdateDrawFrame();
    }
#endif

    sim->cleanup();
    CloseWindow();
    return 0;
}
