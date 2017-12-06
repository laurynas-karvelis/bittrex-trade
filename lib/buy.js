const Trade = require('./trade');

class Buy extends Trade {
    constructor(market, quantity, api, options = {}) {
        super(market, quantity, api);

        this._orderMethodName = 'buyLimit';
        this.orderFulfillTimeLimit = options.orderFulfillTimeLimit || 10 * 1000;
        this.refetchOrderOnCancellationAfter = options.refetchOrderOnCancellationAfter || 1000;
    }

    async _gerOrderQuantityAndRate() {
        const ticker = await this.api.ticker(this.market);

        const rate = ticker.Bid;
        const quantity = this.quantity.minus(this.getExecutedBaseQuantity()).dividedBy(rate);

        return {quantity, rate};
    }
}

module.exports = Buy;
