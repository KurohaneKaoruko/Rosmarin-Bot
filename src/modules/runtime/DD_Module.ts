import { mountDD, checkDDMessages, ddTools } from '../infra/ddcomm'

export const DDModule = {
    init: () => {
        mountDD();
        global.dd = ddTools;
    },
    start: () => {
        checkDDMessages()
    },
}