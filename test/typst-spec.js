describe("Typst subset parser", function() {
    it("parses arithmetic and scripts", function() {
        expect`x_1^2 + y`.toBuild();
        expect`(a + b) * c`.toBuild();
        expect`a -> b`.toBuild();
    });

    it("parses fraction and roots", function() {
        expect`a / b`.toBuild();
        expect`frac(a + 1, sqrt(b))`.toBuild();
        expect`root(3, x + 1)`.toBuild();
    });

    it("parses accent calls", function() {
        expect`accent(a, arrow)`.toBuild();
        expect`hat(x) + underline(y)`.toBuild();
    });

    it("parses let bindings", function() {
        expect`let t = x^2; frac(t + 1, t - 1)`.toBuild();
    });

    it("parses cases rows", function() {
        expect('cases(x, "if x >= 0"; -x, "otherwise")').toBuild();
    });

    it("reports errors for invalid accent calls", function() {
        expect`accent(x)`.toFailWithParseError();
    });
});
