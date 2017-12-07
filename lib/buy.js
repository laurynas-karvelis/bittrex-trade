const Trade = require('./trade');

class Buy extends Trade {
    constructor(market, quantity, api, options = {}) {
        super(market, quantity, api);

        this._orderMethodName = 'buyLimit';
        this.orderFulfillTimeLimit = options.orderFulfillTimeLimit || 10 * 1000;
        this.refetchOrderOnCancellationAfter = options.refetchOrderOnCancellationAfter || 1000;
    }

    async _gerOrderQuantityAndRate() {
        const ticker = await this._privateApi.ticker(this.market);

        const rate = ticker.Bid;
        const remainingQuantity = this.quantity.minus(this.getExecutedBaseQuantity()).dividedBy(rate);
        const quantity = await this._adjustQuantity(remainingQuantity, 'sell');

        return {quantity, rate};
    }
}

module.exports = Buy;
