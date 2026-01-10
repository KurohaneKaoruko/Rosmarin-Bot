const EventModule = {
    tick: function () {
        // 未实现
        
        // if(!global.events) global.events = {};
        // Object.keys(global.events).forEach((key) => {
        //     const event = global.events[key];
        //     if (!event.exec || typeof event.exec !== 'function') {
        //         delete global.events[key];
        //         return;
        //     }
        //     if (!event.state || typeof event.state !== 'function') {
        //         event.exec();
        //         delete global.events[key];
        //         return;
        //     }
        //     const result = event.state();
        //     if (result.exceute) event.exec();
        //     if (result.done) delete global.events[key];
        // })
    }
}

export {EventModule};