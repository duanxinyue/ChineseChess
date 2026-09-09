// 本地复刻版：仅保留界面交互逻辑，不包含任何远程接口调用
function showLogin() {
    $("#modal-login").modal('show');
    $("#modal-register").modal('hide');
}
function showRegister() {
    $("#modal-login").modal('hide');
    $("#modal-register").modal('show');
}

$(function () {
    // 本地版登录/注册为演示界面，不做真实提交
    $("#modal-login .btn-primary").on("click", function () {
        layer.msg("本地演示版本，未接入真实账户系统");
    });
    $("#modal-register .btn-primary").on("click", function () {
        layer.msg("本地演示版本，未接入真实账户系统");
    });
});