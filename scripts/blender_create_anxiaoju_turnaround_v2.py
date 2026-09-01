import bpy
import math
import os
from mathutils import Vector


OUTPUT_DIR = r"C:\Users\HP\Desktop\ai-studyreport-local\outputs\pet-3d-source\安小居"
BLEND_PATH = os.path.join(OUTPUT_DIR, "安小居_正式四视图基础模型_v2.blend")


def mat(name, color, metallic=0.0, roughness=0.3):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next((node for node in m.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError("未找到Principled BSDF材质节点")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def polygon_prism(name, points, depth, material, y=0.0, bevel=0.07):
    n = len(points)
    verts = [(x, y - depth / 2, z) for x, z in points]
    verts += [(x, y + depth / 2, z) for x, z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    mod = obj.modifiers.new("圆润边缘", "BEVEL")
    mod.width = bevel
    mod.segments = 6
    return obj


def sphere(name, loc, scale, material, segments=64, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def rounded_box(name, loc, scale, rotation, material, bevel=0.18):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    mod = obj.modifiers.new("大圆角", "BEVEL")
    mod.width = bevel
    mod.segments = 8
    return obj


def curve(name, points, material, thickness=0.018):
    data = bpy.data.curves.new(name + "_Curve", "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = thickness
    data.bevel_resolution = 5
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_camera(name, location, target, ortho=4.1):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = name
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    return camera


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

blue = mat("安小居标准蓝", (0.005, 0.39, 0.91), metallic=0.08, roughness=0.22)
cyan = mat("安小居标准青", (0.02, 0.72, 0.95), metallic=0.06, roughness=0.2)
white = mat("安小居暖白", (0.97, 0.975, 1.0), roughness=0.24)
navy = mat("眼线深蓝", (0.005, 0.02, 0.12), roughness=0.2)
iris = mat("虹膜蓝", (0.0, 0.39, 1.0), metallic=0.1, roughness=0.16)
iris_cyan = mat("虹膜青", (0.0, 0.82, 1.0), metallic=0.08, roughness=0.14)
pink = mat("腮红", (1.0, 0.66, 0.70), roughness=0.4)
red = mat("嘴", (0.72, 0.015, 0.035), roughness=0.32)
sole = mat("鞋底白", (0.92, 0.96, 1.0), roughness=0.28)

# 正式形象使用完整圆角屋顶外壳；前后白色面板嵌入外壳，侧面自然呈现厚度。
shell_points = [
    (-1.02, -0.48), (-1.02, 0.58), (-0.76, 0.82),
    (0.0, 1.45), (0.76, 0.82), (1.02, 0.58), (1.02, -0.48)
]
panel_points = [
    (-0.86, -0.42), (-0.86, 0.50), (-0.63, 0.69),
    (0.0, 1.20), (0.63, 0.69), (0.86, 0.50), (0.86, -0.42)
]
polygon_prism("安小居_蓝色屋顶外壳", shell_points, 0.94, blue, y=0.0, bevel=0.15)
polygon_prism("安小居_正面白色面板", panel_points, 0.10, white, y=-0.51, bevel=0.10)
polygon_prism("安小居_背面白色面板", panel_points, 0.10, white, y=0.51, bevel=0.10)

# 下沿围绕整圈，中央箭头独立前凸但与腰带连续。
rounded_box("安小居_下沿蓝带", (0.0, 0.0, -0.43), (0.90, 0.50, 0.20), (0, 0, 0), blue, bevel=0.13)
chevron = [(-0.30, -0.63), (-0.30, -0.30), (0.0, -0.02), (0.30, -0.30), (0.30, -0.63), (0.0, -0.39)]
polygon_prism("安小居_中央安居尖角", chevron, 0.16, cyan, y=-0.53, bevel=0.055)

# 正面五官：尺寸、间距按正式基准图收紧，避免上一版的凸出“虫眼”。
front_y = -0.585
for side in (-1, 1):
    x = side * 0.35
    sphere(f"眼线_{side}", (x, front_y - 0.015, 0.38), (0.205, 0.035, 0.285), navy)
    sphere(f"眼白_{side}", (x, front_y - 0.048, 0.38), (0.172, 0.025, 0.248), white)
    sphere(f"虹膜_{side}", (x, front_y - 0.074, 0.35), (0.126, 0.019, 0.205), iris)
    sphere(f"虹膜下高光_{side}", (x, front_y - 0.091, 0.29), (0.085, 0.012, 0.075), iris_cyan, 40, 20)
    sphere(f"瞳孔_{side}", (x, front_y - 0.098, 0.40), (0.072, 0.010, 0.125), navy, 40, 20)
    sphere(f"主高光_{side}", (x - side * 0.035, front_y - 0.112, 0.49), (0.040, 0.008, 0.054), white, 32, 16)
    sphere(f"次高光_{side}", (x + side * 0.030, front_y - 0.114, 0.43), (0.018, 0.007, 0.023), white, 24, 12)
    sphere(f"腮红_{side}", (side * 0.64, front_y - 0.058, 0.05), (0.14, 0.014, 0.068), pink, 40, 20)

curve("左眉", [(-0.52, -0.655, 0.72), (-0.36, -0.678, 0.79), (-0.22, -0.655, 0.72)], navy, 0.024)
curve("右眉", [(0.22, -0.655, 0.72), (0.36, -0.678, 0.79), (0.52, -0.655, 0.72)], navy, 0.024)
curve("微笑", [(-0.13, -0.685, 0.02), (0.0, -0.702, -0.075), (0.13, -0.685, 0.02)], red, 0.022)

# 短手短脚按正式待机比例；分件保留，下一步可直接绑定骨骼。
for side in (-1, 1):
    arm_x = side * 0.94
    sphere(f"{'左' if side < 0 else '右'}上臂", (arm_x, 0.0, -0.05), (0.21, 0.25, 0.39), blue)
    sphere(f"{'左' if side < 0 else '右'}手", (side * 1.00, -0.12, -0.31), (0.24, 0.25, 0.24), blue)
    # 拳缝只放在正面，不额外添加手指结构。
    curve(f"拳缝_{side}", [(side * 0.94, -0.383, -0.30), (side * 1.00, -0.392, -0.35)], navy, 0.012)

    leg_x = side * 0.40
    sphere(f"{'左' if side < 0 else '右'}腿", (leg_x, 0.0, -0.84), (0.22, 0.25, 0.42), blue)
    rounded_box(f"{'左' if side < 0 else '右'}袜口", (leg_x, -0.01, -0.93), (0.23, 0.27, 0.085), (0, 0, 0), sole, bevel=0.075)
    shoe = sphere(f"{'左' if side < 0 else '右'}鞋", (leg_x, -0.15, -1.15), (0.32, 0.42, 0.21), blue)
    sole_obj = rounded_box(f"{'左' if side < 0 else '右'}鞋底", (leg_x, -0.19, -1.30), (0.33, 0.40, 0.065), (0, 0, 0), sole, bevel=0.055)

# 统一控制根节点。
bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.object
root.name = "安小居_ROOT"
root.empty_display_size = 0.45
for obj in list(bpy.context.scene.objects):
    if obj != root and obj.type not in {"CAMERA", "LIGHT"}:
        obj.parent = root

# 灯光与透明渲染。
bpy.ops.object.light_add(type="AREA", location=(-4.5, -5.5, 6.0))
bpy.context.object.data.energy = 950
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 4.0
bpy.ops.object.light_add(type="AREA", location=(4.2, -2.5, 3.8))
bpy.context.object.data.energy = 620
bpy.context.object.data.size = 3.0
bpy.ops.object.light_add(type="AREA", location=(0.0, 4.0, 5.5))
bpy.context.object.data.energy = 820
bpy.context.object.data.size = 3.2

cameras = {
    "正面": add_camera("正面参考相机", (0, -8.0, 0.05), (0, 0, 0.0)),
    "右侧": add_camera("右侧参考相机", (6.2, -6.2, 0.10), (0, 0, 0.0)),
    "背面": add_camera("背面参考相机", (0, 8.0, 0.05), (0, 0, 0.0)),
    "左侧": add_camera("左侧参考相机", (-6.2, -6.2, 0.10), (0, 0, 0.0)),
}

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.view_settings.look = "AgX - Medium High Contrast"

os.makedirs(OUTPUT_DIR, exist_ok=True)
for view_name, camera in cameras.items():
    scene.camera = camera
    scene.render.filepath = os.path.join(OUTPUT_DIR, f"安小居_{view_name}_v2.png")
    bpy.ops.render.render(write_still=True)

scene.camera = cameras["正面"]
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
print("ANXIAOJU_TURNAROUND_V2_DONE", BLEND_PATH)
