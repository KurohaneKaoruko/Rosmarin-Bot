import mountGlobal from './global'
import mountHelp from './help'

/** 控制台命令拓展 */
export const ConsoleExtension = function () {
    mountGlobal();
    mountHelp();
}

