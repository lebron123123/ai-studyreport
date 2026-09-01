import bpy
import math
import os
from mathutils import Vector

OUTPUT_DIR = r"C:\Users\HP\Desktop\ai-studyreport-local\outputs\pet-3d-source\安小居"
BLEND_PATH = os.path.join(OUTPUT_DIR, "安小居_基础模型_v1.blend")
PREVIEW_PATH = os.path.join(OUTPUT_DIR, "安小居_基础模型_v1.png")


def material(name, color, metallic=0.0, roughness=0.34):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError("当前Blender版本未创建Principled BSDF节点")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def extruded_polygon(name, points, depth, mat, bevel=0.10, y=0.0):
    n = len(points)
    verts = [(x, y-depth/2, z) for x, z in points] + [(x, y+depth/2, z) for x, z in points]
    faces = [tuple(range(n)), tuple(range(n, 2*n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n+j, n+i))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bevel_mod = obj.modifiers.new("柔和圆角", "BEVEL")
    bevel_mod.width = bevel
    bevel_mod.segments = 4
    return obj


def uv(name, location, scale, mat, segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def capsule(name, location, scale, rotation, mat):
    obj = uv(name, location, scale, mat)
    obj.rotation_euler = rotation
    return obj


def curve_line(name, points, bevel, mat):
    curve = bpy.data.curves.new(name + "Curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = bevel
    curve.bevel_resolution = 5
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for bp, co in zip(spline.bezier_points, points):
        bp.co = co
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


# 清空默认场景
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    pass

blue = material("深安居蓝", (0.015, 0.48, 0.90), metallic=0.10, roughness=0.26)
cyan = material("深安居青蓝", (0.04, 0.75, 0.93), metallic=0.06, roughness=0.25)
white = material("面部珍珠白", (0.96, 0.985, 1.0), metallic=0.0, roughness=0.30)
navy = material("瞳孔深蓝", (0.01, 0.045, 0.18), metallic=0.05, roughness=0.18)
iris = material("虹膜亮蓝", (0.00, 0.43, 1.0), metallic=0.18, roughness=0.18)
pink = material("腮红粉", (1.0, 0.56, 0.62), roughness=0.42)
mouth_mat = material("微笑红", (0.72, 0.035, 0.055), roughness=0.38)

# 主体采用“房屋+安居标志缺口”轮廓
roof_points = [(-1.34, -0.45), (-1.34, 0.72), (0.0, 1.78), (1.34, 0.72), (1.34, -0.45)]
face_points = [(-1.08, -0.56), (-1.08, 0.62), (0.0, 1.48), (1.08, 0.62), (1.08, -0.56)]
extruded_polygon("安小居_蓝色屋顶", roof_points, 0.70, blue, bevel=0.16, y=0.12)
extruded_polygon("安小居_白色面板", face_points, 0.34, white, bevel=0.12, y=-0.34)

# 下沿蓝色腰带与中央安居尖角
capsule("安小居_腰带", (0, -0.58, -0.58), (1.13, 0.22, 0.26), (0, 0, 0), blue)
notch_points = [(-0.34, -0.78), (-0.34, -0.36), (0.0, -0.02), (0.34, -0.36), (0.34, -0.78), (0.0, -0.48)]
extruded_polygon("安小居_中心安居标", notch_points, 0.26, cyan, bevel=0.07, y=-0.78)

# 眼睛、虹膜、高光
for side in (-1, 1):
    x = 0.43 * side
    uv("眼白_" + str(side), (x, -0.76, 0.46), (0.30, 0.11, 0.39), white)
    uv("虹膜_" + str(side), (x, -0.875, 0.43), (0.205, 0.055, 0.28), iris)
    uv("瞳孔_" + str(side), (x, -0.925, 0.44), (0.112, 0.035, 0.18), navy)
    uv("眼睛高光_" + str(side), (x-0.045*side, -0.963, 0.56), (0.055, 0.018, 0.070), white, 32, 16)
    uv("腮红_" + str(side), (0.74*side, -0.79, 0.02), (0.19, 0.035, 0.10), pink, 32, 16)

# 眉毛与微笑
curve_line("左眉", [(-0.67, -0.92, 0.82), (-0.47, -0.97, 0.91), (-0.27, -0.92, 0.82)], 0.035, navy)
curve_line("右眉", [(0.27, -0.92, 0.82), (0.47, -0.97, 0.91), (0.67, -0.92, 0.82)], 0.035, navy)
curve_line("微笑", [(-0.18, -0.94, -0.03), (0.0, -0.98, -0.16), (0.18, -0.94, -0.03)], 0.032, mouth_mat)

# 手脚；分件命名便于下一步绑定骨骼
capsule("左臂", (-1.23, -0.18, -0.17), (0.23, 0.23, 0.55), (0, -0.10, -0.34), blue)
capsule("右臂", (1.23, -0.18, -0.17), (0.23, 0.23, 0.55), (0, 0.10, 0.34), blue)
uv("左手", (-1.38, -0.36, -0.47), (0.31, 0.24, 0.28), blue)
uv("右手", (1.38, -0.36, -0.47), (0.31, 0.24, 0.28), blue)
capsule("左腿", (-0.50, 0.0, -1.07), (0.29, 0.30, 0.50), (0.05, 0.10, -0.16), blue)
capsule("右腿", (0.50, 0.0, -1.07), (0.29, 0.30, 0.50), (-0.05, -0.10, 0.16), blue)
capsule("左鞋", (-0.55, -0.30, -1.41), (0.40, 0.48, 0.22), (0, 0, -0.06), cyan)
capsule("右鞋", (0.55, -0.30, -1.41), (0.40, 0.48, 0.22), (0, 0, 0.06), cyan)

# 根控制器，为后续骨骼和网页导出预留统一原点
bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.object
root.name = "安小居_ROOT"
root.empty_display_size = 0.55
for obj in list(bpy.context.scene.objects):
    if obj != root and obj.type not in {"CAMERA", "LIGHT"}:
        obj.parent = root

# 柔和棚拍灯光
bpy.ops.object.light_add(type="AREA", location=(-4.2, -5.0, 6.0))
key = bpy.context.object
key.name = "主光"
key.data.energy = 850
key.data.shape = "DISK"
key.data.size = 4.0
key.rotation_euler = (math.radians(28), 0, math.radians(-38))
bpy.ops.object.light_add(type="AREA", location=(4.0, -2.0, 3.0))
fill = bpy.context.object
fill.name = "补光"
fill.data.energy = 520
fill.data.size = 3.5
fill.rotation_euler = (math.radians(62), 0, math.radians(138))
bpy.ops.object.light_add(type="AREA", location=(0, 2.5, 5.5))
rim = bpy.context.object
rim.name = "轮廓光"
rim.data.energy = 700
rim.data.size = 3.0
rim.rotation_euler = (math.radians(-20), 0, math.radians(180))

# 正面正交相机
bpy.ops.object.camera_add(location=(0, -9.3, 0.15))
camera = bpy.context.object
camera.name = "网站正面相机"
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.4
camera.rotation_euler = (math.radians(90), 0, 0)
camera.rotation_euler = (math.radians(90), 0, 0)
direction = Vector((0, 0, 0.05)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.render.filepath = PREVIEW_PATH
scene.world.color = (0.025, 0.035, 0.055)
scene.view_settings.look = "AgX - Medium High Contrast"

os.makedirs(OUTPUT_DIR, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
bpy.ops.render.render(write_still=True)
print("ANXIAOJU_BASE_DONE", BLEND_PATH, PREVIEW_PATH)
