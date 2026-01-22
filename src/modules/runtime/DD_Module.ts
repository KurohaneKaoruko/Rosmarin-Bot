import { mountDD, checkDDMessages, ddTools } from '../infra/dd'

export const DDModule = {
    init: () => {
        mountDD();
        global.dd = ddTools;
    },
    start: () => {
        checkDDMessages()
    },
}