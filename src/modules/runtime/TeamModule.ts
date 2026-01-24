import {TeamSpawner, TeamController} from "@/modules/feature/Team";

const TeamModule = {
    start: function () {
        TeamSpawner.run();
    },

    tick: function () {
        TeamController.run();
    },
}

export { TeamModule }
