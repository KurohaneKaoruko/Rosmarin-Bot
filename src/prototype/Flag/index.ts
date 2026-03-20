import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./spawns/aidSpawn"
import ClaimSpawnFunction from "./spawns/claimSpawn"
import WarSpawnFunction from "./spawns/warSpawn"
import UpSpawnFunction from "./spawns/upSpawn"

const plugins = [
    BaseFunction,
    ClaimSpawnFunction,
    AidSpawnFunction,
    WarSpawnFunction,
    UpSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
