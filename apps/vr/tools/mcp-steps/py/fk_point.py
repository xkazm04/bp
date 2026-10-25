# Content step (spark vr-fidelity-40 FK, elements 6 and 12): the capture's right hand points at the pointed room, and a
# warm rim from the lamp's side models the hands, after studio_level.py (which places the hands at rest). Visual only, as
# the hands are (owner, 2026-10-24). Replayable: the hand is set from studio_level.py's rest placement, and the rim light
# carries the tag BpHandRim and is removed first.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fk-assembly.jsonl
#
# - The point: FL's right hand (01ab214) is posed pointing in the mesh; at rest its index tip lands at table (X -22, Y 17)
#   cm, at paper height (FL's hand-over). Only the actor moves, by (target - rest tip). The target is just in front of
#   the pointed room's near edge, toward its left side, as the concept's fingertip under its raised room: the target
#   capture points at "communications", whose raised copy spans table X -9.9..6.5, Y 25.2..44.9 (HighlightShell,
#   measured in PIE at BpView.Pose target, Lynx 2026-10-25). Axis mapping: table X away from the player, Y to the right.
#   FP lifts that room whole (its floor 4 cm up, its furniture on it) and points the tip into it: inside the near wall,
#   raised TIP_LIFT with the hand (the judge: "the finger points below it, not into it").
# - The rim: the judge read the hands' lighting as flat. A small warm spot from the far (lamp) side, high, on the hands'
#   lighting channel only (channel 1, fid_look.py's TableKey channel, which only the capture hands carry), grazing the
#   backs of the hands and the knuckles; with the cyan key from below it is the Blender renders' light (FL).
import unreal

TAG = "BpHandRim"
REST_LOC = (-34.0, 0.0, 94.2)  # studio_level.py: (PAPER_NEAR_X + HANDS_IN, 0, PAPER_Z)
REST_YAW = 90.0                # studio_level.py: HANDS_YAW
TIP_REST = (-22.0, 17.0)
TIP_TARGET = (-7.5, 31.0)  # FP: (from -11.5, 29) into the lifted room, just past its near wall, over its raised floor
TIP_LIFT = 7.0             # FP: the hand raised so the tip stands at the room's lifted floor (HighlightLiftCm 4), by capture
RIM_AT = (45.0, 5.0, 150.0)
RIM_AIM = (-15.0, 18.0, 98.0)
RIM_CD = 6.0
RIM_RADIUS = 160.0
RIM_COLOUR = unreal.Color(r=255, g=196, b=140, a=255)

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level("/Game/Maps/LightTable")
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)
hand = next(a for a in eas.get_all_level_actors() if a.get_actor_label() == "CaptureHandR")
move = (TIP_TARGET[0] - TIP_REST[0], TIP_TARGET[1] - TIP_REST[1], 0.0)
loc = unreal.Vector(REST_LOC[0] + move[0], REST_LOC[1] + move[1], REST_LOC[2] + TIP_LIFT)
hand.set_actor_location_and_rotation(loc, unreal.Rotator(0.0, 0.0, REST_YAW), False, False)

aim = unreal.Vector(*RIM_AIM) - unreal.Vector(*RIM_AT)
rim = eas.spawn_actor_from_class(unreal.SpotLight, unreal.Vector(*RIM_AT), unreal.MathLibrary.make_rot_from_x(aim))
rim.set_actor_label("HandRim")
rim.set_editor_property("tags", [unreal.Name(TAG)])
lc = rim.get_component_by_class(unreal.SpotLightComponent)
lc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
lc.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
lc.set_editor_property("intensity", RIM_CD)
lc.set_editor_property("light_color", RIM_COLOUR)
lc.set_editor_property("attenuation_radius", RIM_RADIUS)
lc.set_editor_property("outer_cone_angle", 22.0)
lc.set_editor_property("inner_cone_angle", 10.0)
lc.set_editor_property("cast_shadows", False)
lc.set_editor_property("volumetric_scattering_intensity", 0.0)
lc.set_editor_property("lighting_channels", unreal.LightingChannels(channel0=False, channel1=True, channel2=False))
result = {"hand": [loc.x, loc.y, loc.z], "move": list(move), "rim": {"at": list(RIM_AT), "cd": RIM_CD},
          "saved": les.save_current_level()}
