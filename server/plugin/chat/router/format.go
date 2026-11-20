package router

import "strconv"

func fmtUint(value uint) string { return strconv.FormatUint(uint64(value), 10) }
