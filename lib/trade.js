const EventEmitter = require('events'),
    BigNumber = require('bignumber.js'),
    Promise = require('bluebird'),
    _ = require('lodash');

class Trade extends EventEmitter {
    constructor(market, quantity, api) {
        super();
        this.api = api;
        this.isComplete = false;

        this.market = market;
        this.quantity = new BigNumber(quantity);

        this.executedOrders = [];
        this.executedRates = [];
        this.executedBaseQuantities = [];
        this.executedQuantities = [];
    }

    async execute() {
        let uuid;
        const {quantity, rate} = this._gerOrderQuantityAndRate();

        // actually place the order and wait
        try {
            uuid = await this.api[this._orderMethodName](this.market, quantity, rate);
        } catch (e) {
            if (e.message === 'MIN_TRADE_REQUIREMENT_NOT_MET') {
                // consider trade complete as we hit minimal purchasable quantity limit
                this.isComplete = true;
                this.emit('trade-complete');

                // done.
                return;
            }

            // otherwise throw
            throw e;
        }

        // let order to be filled as much as reasonably possible and fetch it's results
        await Promise.delay(this.orderFulfillTimeLimit);
        let order = await this.api.order(uuid);

        // decide what to do next with this order
        if (order.IsOpen) {
            // order is closed / fulfilled completely
            this._registerOrder(order);
        } else {
            // order is completely or partially unfulfilled, cancel it
            try {
                await this.api.cancel(uuid);
            } catch (e) {
                // ORDER_NOT_OPEN means it's already fully fulfilled
                if (e.message !== 'ORDER_NOT_OPEN') {
                    throw e;
                }
            }

            await Promise.delay(this.refetchOrderOnCancellationAfter);

            // once cancelled and after a cool-down lets refetch cancelled order's details again
            // this is needed as sometimes Bittrex fails to cancel the order immediately
            order = await this.api.order(uuid);
            this._registerOrder(order);
        }

        // someone might find this useful if verbosity is needed
        this.emit('order-iteration-complete', order);

        // lets recurse
        return this.execute();
    }

    _registerOrder(order) {
        this.executedOrders.push(order);

        const executedRate = order.PricePerUnit;
        const executedQuantity = order.Quantity.minus(order.QuantityRemaining);
        const executedBaseQuantity = executedQuantity.times(executedRate);

        if (executedQuantity.gt(0)) {
            this.executedRates.push(executedRate);
            this.executedQuantities.push(executedQuantity);
            this.executedBaseQuantities.push(executedBaseQuantity);
        }
    }

    getExecutedOrders() {
        return this.executedOrders;
    }

    getExecutedBaseQuantity() {
        return new BigNumber(_.reduce(this.executedBaseQuantities, (sum, n) => n.add(sum), 0));
    }

    getExecutedQuantity() {
        return new BigNumber(_.reduce(this.executedQuantities, (sum, n) => n.add(sum), 0));
    }

    getExecutedMeanRate() {
        if (!this.executedRates.length) {
            return NaN;
        }

        const acc = _.reduce(this.executedRates, (sum, n) => n.add(sum), 0);
        return acc.div(this.executedRates.length);
    }

    toJSON() {
        const keys = [
            'isComplete', 'market', 'executedOrders', 'executedRates',
            'executedBaseQuantities', 'executedQuantities'
        ];
        const obj = _.pick(this, keys);

        const executedBaseQuantity = this.getExecutedBaseQuantity();
        const executedQuantity = this.getExecutedQuantity();
        const executedMeanRate = this.getExecutedMeanRate();

        _.extend(obj, {
            quantity: this.quantity.toNumber(),
            executedBaseQuantity: executedBaseQuantity instanceof BigNumber ? executedBaseQuantity.toNumber() : executedBaseQuantity,
            executedQuantity: executedQuantity instanceof BigNumber ? executedQuantity.toNumber() : executedQuantity,
            executedMeanRate: executedMeanRate instanceof BigNumber ? executedMeanRate.toNumber() : executedMeanRate
        });

        return obj;
    }
}

module.exports = Trade;
