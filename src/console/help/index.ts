import funcAlias from './help'


export default function () {
    funcAlias.map(item => {
        if (global[item.alias]) return;
        Object.defineProperty(global, item.alias, { get: item.exec })
    })
};
